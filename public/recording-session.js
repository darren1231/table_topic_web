(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RecordingSession=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function create() { return { status: 'idle', segments: [], totalSeconds: 0 }; }
  function resume(session) {
    return session.status === 'recording' ? session : { ...session, status: 'recording' };
  }
  function seal(session, status, seconds = 0) {
    if (session.status !== 'recording') return status === 'stopped' ? { ...session, status } : session;
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) throw new TypeError('Invalid segment duration');
    const segment = { sequence: session.segments.length + 1, seconds, submitted: false };
    return { status, totalSeconds: session.totalSeconds + seconds, segments: [...session.segments, segment] };
  }
  function interrupt(session, seconds) { return seal(session, 'interrupted', seconds); }
  function stop(session, seconds) { return seal(session, 'stopped', seconds); }
  function takePending(session) {
    return {
      segments: session.segments.filter(segment => !segment.submitted),
      session: { ...session, segments: session.segments.map(segment => segment.submitted ? segment : { ...segment, submitted: true }) },
    };
  }
  return { create, resume, interrupt, stop, takePending };
});
