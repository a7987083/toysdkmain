import {defineConfig} from 'vite';
export default defineConfig(({mode})=>({
  base:'./',build:{target:'es2020',outDir:mode==='mock'?'dist-mock':'dist'},
  plugins:[{name:'toy-host',transformIndexHtml(){
    if(mode==='mock') return [];
    return [{tag:'script',attrs:{src:'https://s1.hdslb.com/bfs/seed/toy/app/sdk/toy-sdk.js'},injectTo:'head-prepend'}];
  }}]
}));
