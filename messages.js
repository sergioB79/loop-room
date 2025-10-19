(function(){
  // Expose a Promise that resolves when messages are loaded
  const url = 'messages/messages.txt';
  window.messages = [];
  window.messagesReady = fetch(url, { cache: 'no-store' })
    .then(resp => resp.ok ? resp.text() : Promise.reject(new Error('Failed to load messages')))
    .then(text => {
      const lines = text.split(/\r?\n/)
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('#'));
      window.messages = lines;
      return lines;
    })
    .catch(() => {
      // Fallback to a small default set if file missing
      window.messages = [
        'Still typing...',
        'You never replied.',
        'This is not a chat.',
        'Loop detected.'
      ];
      return window.messages;
    });
})();

