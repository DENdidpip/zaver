// Centralized PWA and Service Worker helpers
(function() {
  // Register service worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then(registration => {
          console.log('SW registered:', registration.scope);

          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // New version available
                if (confirm('Dostupná je nová verzia hry. Aktualizovať?')) {
                  newWorker.postMessage({ type: 'SKIP_WAITING' });
                  window.location.reload();
                }
              }
            });
          });
        })
        .catch(error => console.log('SW registration failed:', error));
    });
  }

  // beforeinstallprompt handling
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    console.log('PWA ready to install');
    // Optional: you can expose a UI element to call deferredPrompt.prompt()
    // e.g. document.getElementById('installBtn').addEventListener('click', () => { deferredPrompt.prompt(); });
  });

  window.addEventListener('appinstalled', (evt) => {
    console.log('PWA installed');
  });

  // Expose for other modules if needed
  window.__pwaDeferred = () => deferredPrompt;
})();
