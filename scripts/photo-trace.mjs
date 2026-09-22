// Short, authenticated trace of the five preview requests; never print request
// headers, provider URLs, credentials, or unrelated Worker events.
export async function startPhotoTrace(cf, worker) {
  const tail = await cf(`/workers/scripts/${worker}/tails`, 'POST', {});
  const socket = new WebSocket(tail.url, 'trace-v1');
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(Error('Preview trace connection failed')), { once: true });
  });
  socket.addEventListener('message', event => {
    try {
      const data = JSON.parse(String(event.data));
      for (const log of data.logs || []) {
        if (log.message?.[0] === 'THM_MLS_PHOTO_TRACE') console.log('MEDIA_METADATA', log.message[1]);
      }
    } catch {}
  });
  return async () => {
    await new Promise(resolve => setTimeout(resolve, 1500));
    socket.close();
    await cf(`/workers/scripts/${worker}/tails/${tail.id}`, 'DELETE');
  };
}
