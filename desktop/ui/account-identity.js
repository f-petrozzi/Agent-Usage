/* Account identity stays independent of quota color, aliases and display order. */
window.accountSymbolKey=function(account,accounts){
  if(account.base!=='codex')return '';
  const name=account.originalName||account.name||'';
  const named=/^Codex\s*(?:[·:—-]\s*)?([A-Z])$/i.exec(name);
  if(named)return named[1].toUpperCase();
  const peers=accounts.filter(a=>a.base==='codex').slice().sort((a,b)=>String(a.id).localeCompare(String(b.id),'en'));
  if(peers.length<2)return '';
  // Named accounts reserve their letter; unnamed accounts use remaining letters.
  const reserved=new Set(peers.map(a=>/^Codex\s*(?:[·:—-]\s*)?([A-Z])$/i.exec(a.originalName||a.name||'')?.[1]?.toUpperCase()).filter(Boolean));
  const unnamed=peers.filter(a=>!/^Codex\s*(?:[·:—-]\s*)?([A-Z])$/i.test(a.originalName||a.name||''));
  const letters='ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter(letter=>!reserved.has(letter));
  const index=unnamed.findIndex(a=>a.id===account.id);
  return letters[index]||String(index+1);
};

// Identity light belongs to the symbol; quota and activity colors stay on the rings.
window.accountLight=function(account,accounts){
  if(account.id==='collector')return '';
  if(account.base==='codex')return window.accountSymbolKey(account,accounts)==='B'?'codex-b':'codex-a';
  return account.base==='claude'?'claude':account.base==='gemini'?'agy':'';
};
