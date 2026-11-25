import { limits } from '../sdk-contract/index.js';

export interface SaveSchema<T> {
  version: number;
  validate(value: unknown): value is T;
  /** Migrate one version at a time. The result must pass validate at the current version. */
  migrations?: Readonly<Partial<Record<number, (data: unknown) => unknown>>>;
}

export class SaveError extends Error {
  constructor(readonly type: 'invalid_save' | 'save_too_large' | 'corrupt_save' | 'unsupported_version' | 'cache_failure' | 'cache_changed' | 'cache_lock_unavailable',
    options?: ErrorOptions) {
    super(type, options);
    this.name = 'SaveError';
  }
}

const encoder = new TextEncoder();

/** A checksum for accidental corruption, without an authenticity guarantee. */
function checksum(payload: string): string {
  let hash = 0x811c9dc5;
  for (const byte of encoder.encode(payload)) hash = Math.imul(hash ^ byte, 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export class SaveCodec<T> {
  private readonly version: number;

  constructor(private readonly schema: SaveSchema<T>) {
    if (!Number.isSafeInteger(schema.version) || schema.version < 1) throw new SaveError('invalid_save');
    this.version = schema.version;
  }

  encode(value: T): string {
    const encoded = this.serialize(value);
    if (encoder.encode(encoded).byteLength > limits.maxValueBytes) throw new SaveError('save_too_large');
    return encoded;
  }

  measure(value: T) {
    const used = encoder.encode(this.serialize(value)).byteLength;
    return { used, limit: limits.maxValueBytes, remaining: limits.maxValueBytes - used };
  }

  private serialize(value: T): string {
    let payload: string;
    try {
      payload = JSON.stringify({ version: this.version, data: value });
      const roundTrip: unknown = JSON.parse(payload).data;
      if (!this.schema.validate(roundTrip)) throw new SaveError('invalid_save');
    } catch (cause) {
      throw new SaveError('invalid_save', { cause });
    }
    return JSON.stringify({ payload, checksum: checksum(payload) });
  }

  decode(raw: string): T {
    let payload: { version: number; data: unknown };
    try {
      if (encoder.encode(raw).byteLength > limits.maxValueBytes) throw new SaveError('corrupt_save');
      const envelope = JSON.parse(raw);
      if (typeof envelope?.payload !== 'string' || envelope.checksum !== checksum(envelope.payload)) {
        throw new SaveError('corrupt_save');
      }
      payload = JSON.parse(envelope.payload);
      if (!Number.isSafeInteger(payload?.version) || payload.version < 1 || !Object.hasOwn(payload, 'data')) {
        throw new SaveError('corrupt_save');
      }
    } catch (cause) {
      throw new SaveError('corrupt_save', { cause });
    }

    if (payload.version > this.version) throw new SaveError('unsupported_version');
    let value = payload.data;
    for (let version = payload.version; version < this.version; version++) {
      const migrate = this.schema.migrations?.[version];
      if (!migrate) throw new SaveError('unsupported_version');
      try {
        value = migrate(value);
      } catch (cause) {
        throw new SaveError('corrupt_save', { cause });
      }
    }
    if (!this.schema.validate(value)) throw new SaveError('corrupt_save');
    return value;
  }
}
