import type { Scene } from "phaser";
export async function play(point:()=>void) {
  const {default: Phaser}=await import('phaser');
  const game=new Phaser.Game({type:Phaser.CANVAS,width:640,height:360,parent:'game',
    backgroundColor:'#132238',scene:{create(this: Scene){
      const target=this.add.circle(320,180,36,0x72dcaf).setInteractive();
      target.on('pointerdown',()=>{point();target.setPosition(Phaser.Math.Between(48,592),Phaser.Math.Between(48,312));});
    }}});
  return ()=>game.destroy(true);
}
