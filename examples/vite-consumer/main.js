import './style.css';
import image from './mark.svg';
import config from './game.json?url';
const { ToyRuntime } = await import('toy-game-kit/sdk-runtime');
const icon = new Image();
icon.src = image;
await Promise.all([icon.decode(), document.fonts.load('16px ToyFixture')]);
const game = await (await fetch(config)).json();
if (new ToyRuntime().state !== 'idle' || game.version !== 1 || !document.fonts.check('16px ToyFixture')) {
  throw new Error('consumer_asset_failed');
}
document.querySelector('#status').textContent = 'SDK 已载入';
document.documentElement.dataset.consumer = 'ready';
document.documentElement.dataset.navigation = performance.timeOrigin.toString();
