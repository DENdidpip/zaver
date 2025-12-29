// Menu page logic moved from inline script
(function() {
  // Data for levels (fallback if json fetch fails)
  const levelData = [
    { id: 1, name: "Štvorec", description: "Jednoduchá forma", difficulty: "Ľahké" },
    { id: 2, name: "Trojuholník", description: "Klasická forma", difficulty: "Stredné" },
    { id: 3, name: "Lichobežník", description: "Zložitá forma", difficulty: "Ťažké" }
  ];

  function getBestTime(levelId) {
    const bestTimes = JSON.parse(localStorage.getItem('tangramBestTimes') || '{}');
    const time = bestTimes[`level_${levelId}`];
    return time ? formatTime(time) : '--:--';
  }

  function getAttemptCount(levelId) {
    const attempts = JSON.parse(localStorage.getItem('tangramAttempts') || '{}');
    return attempts[`level_${levelId}`] || 0;
  }

  function isLevelCompleted(levelId) {
    const completed = JSON.parse(localStorage.getItem('tangramCompleted') || '{}');
    return completed[`level_${levelId}`] || false;
  }

  // the currently loaded levels (may be fetched from json)
  let loadedLevels = levelData;

  function getTotalStats() {
    const completed = JSON.parse(localStorage.getItem('tangramCompleted') || '{}');
    const attempts = JSON.parse(localStorage.getItem('tangramAttempts') || '{}');
    const completedCount = Object.values(completed).filter(Boolean).length;
    const totalAttempts = Object.values(attempts).reduce((sum, count) => sum + count, 0);
    return { completedCount, totalAttempts, totalLevels: (loadedLevels || []).length };
  }

  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  function createLevelCards(data) {
    const grid = document.getElementById('levelGrid');
    grid.innerHTML = '';
    (data || []).forEach(level => {
      const card = document.createElement('a');
      card.className = 'level-card';
      card.href = `index.html?level=${level.levelId || level.id}`;
      const lid = level.levelId || level.id;
      const bestTime = getBestTime(lid);
      const attempts = getAttemptCount(lid);
      const completed = isLevelCompleted(lid);
      card.innerHTML = `
        <div>Úroveň ${lid}: ${level.name} ${completed ? '✓' : ''}</div>
        <div>${level.description || ''}</div>
        <div>
          <span>${level.difficulty || ''}</span>
          <span>Čas: ${bestTime}</span>
        </div>
        <div>
          <span>Pokusov: ${attempts}</span>
          <span>Stav: ${completed ? 'Dokončené' : 'Nedokončené'}</span>
        </div>
      `;
      grid.appendChild(card);
    });
  }

  function createStatsPanel() {
    const statsPanel = document.getElementById('statsPanel');
    const stats = getTotalStats();
    statsPanel.innerHTML = `
      <h3>Celková štatistika</h3>
      <div class="stats-grid">
        <div class="stat-item">
          <strong>${stats.completedCount}</strong><br>Dokončených úrovní
        </div>
        <div class="stat-item">
          <strong>${stats.totalLevels - stats.completedCount}</strong><br>Zostáva dokončiť
        </div>
        <div class="stat-item">
          <strong>${stats.totalAttempts}</strong><br>Celkovo pokusov
        </div>
        <div class="stat-item">
          <strong>${stats.completedCount > 0 ? Math.round((stats.completedCount / (stats.totalLevels || 1)) * 100) : 0}%</strong><br>Percento dokončenia
        </div>
      </div>
    `;
  }

  document.addEventListener('DOMContentLoaded', function() {
    // Try to load levels.json (cache-busted) and fall back to inline data
    fetch('json/levels.json?t=' + Date.now()).then(r => {
      if (!r.ok) throw new Error('Network response was not ok');
      return r.json();
    }).then(j => {
      loadedLevels = j.levels || levelData;
      createLevelCards(loadedLevels);
      createStatsPanel();
    }).catch(err => {
      console.warn('Failed to load levels.json, using fallback levels:', err);
      loadedLevels = levelData;
      createLevelCards(loadedLevels);
      createStatsPanel();
    });

    const backBtn = document.getElementById('backBtn');
    if (backBtn) backBtn.addEventListener('click', (e) => { e.preventDefault(); history.back(); });
  });
})();
