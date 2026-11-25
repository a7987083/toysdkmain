type Cell = [number,number];
export async function play(point:()=>void) {
  const {label}=await import('./target.json');
  const panel=document.createElement('section');
  const board=document.createElement('pre');
  panel.append(board);
  const body:Cell[]=[[1,1]];
  let food:Cell=[2,1], ended=false;
  const draw=()=>{
    const grid=Array.from({length:8},()=>Array<string>(8).fill('·'));
    grid[food[1]][food[0]]='★';
    for(const [x,y] of body)grid[y][x]='■';
    board.textContent=grid.map(row=>row.join(' ')).join('\n');
  };
  for(const [name,dx,dy] of [['左',-1,0],['上',0,-1],['下',0,1],['右',1,0]] as const){
    const key=document.createElement('button');key.textContent=name;
    key.onclick=()=>{
      if(ended)return;
      const next:Cell=[(body[0][0]+dx+8)%8,(body[0][1]+dy+8)%8];
      const eating=next[0]===food[0] && next[1]===food[1];
      if(!eating)body.pop();
      if(body.some(([x,y])=>x===next[0] && y===next[1])){ended=true;board.textContent='本局结束';return;}
      body.unshift(next);
      if(eating){
        point();
        const empty:Cell[]=[];
        for(let y=0;y<8;y++)for(let x=0;x<8;x++)if(!body.some(c=>c[0]===x&&c[1]===y))empty.push([x,y]);
        if(!empty.length){ended=true;board.textContent='通关';return;}
        food=empty[Math.floor(Math.random()*empty.length)];
      }
      draw();
    };
    panel.append(key);
  }
  board.setAttribute('aria-label',label);
  draw();document.querySelector('#game')!.replaceChildren(panel);
  return ()=>panel.remove();
}
