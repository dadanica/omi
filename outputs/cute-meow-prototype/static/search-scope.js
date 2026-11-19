function parseChatSearch(raw,partner,friends={}){
  const aliases=new Map([['全局','all'],['共同聊天','shared'],[partner,'shared'],['omi私聊','assistant'],['omi','assistant']]);
  for(const [id,name] of Object.entries(friends))aliases.set(name,id);
  const ordered=[...aliases.keys()].filter(Boolean).sort((a,b)=>b.length-a.length);
  let query='',scopes=new Set(),all=false;
  for(let i=0;i<raw.length;){
    if(raw[i]!=='@'&&raw[i]!=='＠'){query+=raw[i++];continue;}
    i++;
    const name=ordered.find(n=>raw.slice(i).toLowerCase().startsWith(n.toLowerCase()));
    if(!name)return {error:'未找到这个聊天',query:'',scopes:[]};
    const scope=aliases.get(name);if(scope==='all')all=true;else scopes.add(scope);
    i+=name.length;
  }
  return {query:query.trim(),scopes:all||!scopes.size?['shared',...Object.keys(friends),'assistant']:[...scopes]};
}
if(typeof module!=='undefined')module.exports=parseChatSearch;
