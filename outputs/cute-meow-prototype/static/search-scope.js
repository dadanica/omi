function parseChatSearch(raw,partner){
  const aliases=new Map([['全局','all'],['个人咪','personal'],['共同聊天','shared'],[partner,'shared'],['可爱咪私聊','assistant'],['可爱咪','assistant']]);
  const ordered=[...aliases.keys()].filter(Boolean).sort((a,b)=>b.length-a.length);
  let query='',scopes=new Set(),all=false;
  for(let i=0;i<raw.length;){
    if(raw[i]!=='@'&&raw[i]!=='＠'){query+=raw[i++];continue;}
    i++;
    const name=ordered.find(n=>raw.startsWith(n,i));
    if(!name)return {error:'未找到这个聊天',query:'',scopes:[]};
    const scope=aliases.get(name);if(scope==='all')all=true;else scopes.add(scope);
    i+=name.length;
  }
  return {query:query.trim(),scopes:all||!scopes.size?['personal','shared','assistant']:[...scopes]};
}
if(typeof module!=='undefined')module.exports=parseChatSearch;
