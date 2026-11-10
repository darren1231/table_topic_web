(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.HtmlUtils=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function escapeHtml(value) {
    const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(value ?? '').replace(/[&<>"']/g, character => entities[character]);
  }
  function safeUrl(value) {
    try {
      const url = String(value ?? '').trim();
      return ['http:', 'https:'].includes(new URL(url).protocol) ? url : '';
    } catch { return ''; }
  }
  return { escapeHtml, safeUrl };
});
