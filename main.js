/*
 * Main entry point for the Arcade Football 1v1 game. This module
 * implements a simple scene system (boot → menu → match), connects
 * PixiJS rendering to a Web Worker running the Box2D physics
 * simulation, handles desktop and mobile inputs, displays a
 * countdown timer and scoreboard, and provides a rudimentary AI
 * opponent on the “Rookie” level. The implementation here
 * prioritises clarity over completeness and should serve as a solid
 * foundation for subsequent iterations.
 */

// Global PixiJS application. It automatically resizes to the
// viewport and uses a solid background colour defined in index.html.
const app = new PIXI.Application({
  resizeTo: window,
  backgroundColor: 0x1099bb,
  antialias: true
});
document.getElementById('game-container').appendChild(app.view);

// -----------------------------------------------------------------------------
// Global error handling and diagnostics overlay
//
// If any uncaught error occurs during initialisation or runtime, an overlay
// appears informing the user instead of silently failing. This assists with
// debugging on devices where the developer console is not visible.
function showErrorOverlay(message) {
  let existing = document.getElementById('error-overlay');
  if (existing) {
    existing.remove();
  }
  const overlay = document.createElement('div');
  overlay.id = 'error-overlay';
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.background = 'rgba(0,0,0,0.8)';
  overlay.style.display = 'flex';
  overlay.style.justifyContent = 'center';
  overlay.style.alignItems = 'center';
  overlay.style.zIndex = '3000';
  overlay.style.color = '#fff';
  overlay.style.fontSize = '16px';
  overlay.style.textAlign = 'center';
  overlay.style.padding = '20px';
  overlay.textContent = 'Ошибка: ' + message;
  document.body.appendChild(overlay);
}

window.addEventListener('error', (e) => {
  console.error('Unhandled error:', e.message, e.error);
  showErrorOverlay(e.message || 'Неизвестная ошибка');
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled promise rejection:', e.reason);
  showErrorOverlay(e.reason && e.reason.message ? e.reason.message : 'Неизвестная ошибка');
});

// Simple audio feedback for goals. Uses the Web Audio API to play a
// short beep. This avoids loading external sound files and works offline.
const audioCtx = (typeof AudioContext !== 'undefined') ? new AudioContext() : null;
function playGoalSound(colour) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  // Blue team uses a higher pitch; red team a lower pitch
  osc.frequency.value = colour === 0x00aaff ? 880 : 440;
  osc.type = 'square';
  gain.gain.value = 0.2;
  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.2);
}

// -----------------------------------------------------------------------------
// Asset preloading
//
// A handful of side‑view characters were generated via the imagegen tool and
// stored under `assets/characters`. These are used to represent the six
// selectable avatars in the menu. Because PixiJS v8 is able to load images
// synchronously when referenced as textures, we simply create the textures up
// front and reuse them. If additional characters are added later, append
// entries here.
const characterTextures = [];
for (let i = 1; i <= 6; i++) {
  // We only generated four distinct images; for player5 and player6 we reuse
  // earlier textures. Texture.from will automatically deduplicate identical
  // sources, so reusing file names is fine. See Step 5 commentary for details.
  const fileName = i <= 4 ? `assets/characters/player${i}.png` : `assets/characters/player${(i % 4) + 1}.png`;
  const tex = PIXI.Texture.from(fileName);
  characterTextures.push(tex);
}

// Currently selected character index for the player. This value is
// modified in the menu when the user picks an avatar and then passed
// to the match scene via the `options` argument.
let selectedCharacterIndex = 0;

// -----------------------------------------------------------------------------
// AI difficulty profiles and replay storage
//
// The game offers five levels of AI sophistication. Each level is defined by
// two parameters: a reaction time (in seconds) indicating how often the AI
// will reconsider its inputs, and an aim error (in degrees) that determines
// how accurately the AI targets the ball when moving or jumping. These
// profiles roughly map to the difficulty names used in the game design
// document. Higher difficulties have faster reactions and smaller errors.
const aiLevels = ['Rookie', 'Amateur', 'Pro', 'Elite', 'Legend'];
const aiProfiles = {
  Rookie:  { reactionTime: 0.30, aimError: 15 },
  Amateur: { reactionTime: 0.25, aimError: 12 },
  Pro:     { reactionTime: 0.20, aimError: 9  },
  Elite:   { reactionTime: 0.15, aimError: 6  },
  Legend:  { reactionTime: 0.12, aimError: 3  }
};
// The currently selected difficulty level. It is adjusted in the menu when
// cycling through the available AI options. Default to Rookie.
let selectedAILevel = 'Rookie';

// A simple replay system persists finished matches to localStorage. Each
// replay is an object with a timestamp, the AI level, final score and a
// sequence of frames. Frames capture the positions of the ball and players
// roughly ten times per second alongside the remaining time and score at
// that moment. Replays can later be played back at various speeds. We
// lazily load the stored list on startup and save it back whenever a
// replay is added or removed.
let replays = [];
function loadReplays() {
  try {
    const json = localStorage.getItem('replays');
    replays = json ? JSON.parse(json) : [];
  } catch (e) {
    replays = [];
  }
}
function saveReplays() {
  localStorage.setItem('replays', JSON.stringify(replays));
}
loadReplays();


// Scene management helpers. Each scene clears the stage and
// constructs its own display list.
function clearStage() {
  app.stage.removeChildren();
  app.ticker.stop();
  app.ticker.destroy();
  app.ticker = new PIXI.Ticker();
  app.ticker.start();
}

// Show the boot screen. Displays a loading message briefly before
// transitioning to the menu.
function showBoot() {
  clearStage();
  const text = new PIXI.Text('Загрузка…', {
    fontFamily: 'Arial',
    fontSize: 32,
    fill: 0xffffff
  });
  text.anchor.set(0.5);
  text.x = app.renderer.width / 2;
  text.y = app.renderer.height / 2;
  app.stage.addChild(text);
  // Immediately transition to the main menu on first load. Originally a
  // one‑second delay was used during development to demonstrate the boot
  // screen, but this created a blue screen on some hosts. To satisfy the
  // requirement that the menu appears right away, we remove the delay and
  // render the tutorial shortly thereafter if necessary. A small timeout
  // (0 ms) ensures the browser finishes layout before drawing the menu.
  setTimeout(() => {
    showMenu();
    if (!localStorage.getItem('tutorialDone')) {
      // Present the tutorial shortly after the menu is visible so the
      // overlay doesn’t interrupt layout calculations.
      setTimeout(showTutorial, 500);
    }
  }, 0);
}

// Show the main menu. Presents a title and a button to start a match
// against the AI (Rookie difficulty).
function showMenu() {
  clearStage();
  const container = new PIXI.Container();
  app.stage.addChild(container);
  // Title
  const title = new PIXI.Text('Arcade Football 1v1', {
    fontFamily: 'Arial',
    fontSize: 48,
    fill: 0xffffff,
    fontWeight: 'bold',
    dropShadow: true,
    dropShadowBlur: 4,
    dropShadowColor: 0x000000,
    dropShadowDistance: 2
  });
  title.anchor.set(0.5);
  title.x = app.renderer.width / 2;
  title.y = app.renderer.height * 0.3;
  container.addChild(title);
  // Character selection row
  {
    const row = new PIXI.Container();
    row.y = app.renderer.height * 0.4;
    row.x = app.renderer.width / 2;
    const spacing = 90;
    const icons = [];
    characterTextures.forEach((tex, idx) => {
      const iconContainer = new PIXI.Container();
      // faint background circle
      const bg = new PIXI.Graphics();
      bg.beginFill(0xffffff, 0.2);
      bg.drawCircle(0, 0, 38);
      bg.endFill();
      iconContainer.addChild(bg);
      // sprite
      const spr = new PIXI.Sprite(tex);
      spr.anchor.set(0.5);
      const maxDim = 60;
      const sc = Math.min(maxDim / spr.texture.width, maxDim / spr.texture.height);
      spr.scale.set(sc);
      iconContainer.addChild(spr);
      // outline indicator
      const outline = new PIXI.Graphics();
      outline.lineStyle(4, 0xffff00);
      outline.drawCircle(0, 0, 40);
      outline.visible = idx === selectedCharacterIndex;
      iconContainer.addChild(outline);
      icons.push({ bg, outline });
      // position horizontally
      iconContainer.x = (idx - (characterTextures.length - 1) / 2) * spacing;
      // interaction
      iconContainer.interactive = true;
      iconContainer.buttonMode = true;
      iconContainer.on('pointerdown', () => {
        selectedCharacterIndex = idx;
        icons.forEach((it, i) => {
          it.outline.visible = i === selectedCharacterIndex;
          it.bg.alpha = i === selectedCharacterIndex ? 0.5 : 0.2;
        });
      });
      row.addChild(iconContainer);
    });
    container.addChild(row);
  }

  // Difficulty button to cycle through AI levels. The button text shows
  // the current difficulty and cycles through the predefined list on
  // each click. Changing the difficulty updates the global
  // `selectedAILevel`, which is read when starting a match.
  const diffText = new PIXI.Text(`AI: ${selectedAILevel}`, {
    fontFamily: 'Arial',
    fontSize: 28,
    fill: 0x000000,
    fontWeight: 'bold'
  });
  const diffBtn = buildButton(diffText, () => {
    // Cycle to next difficulty
    let idx = aiLevels.indexOf(selectedAILevel);
    idx = (idx + 1) % aiLevels.length;
    selectedAILevel = aiLevels[idx];
    diffText.text = `AI: ${selectedAILevel}`;
  });
  diffBtn.anchor = new PIXI.Point(0.5, 0.5);
  diffBtn.x = app.renderer.width / 2;
  diffBtn.y = app.renderer.height * 0.50;
  container.addChild(diffBtn);

  // Play button
  const playText = new PIXI.Text('Играть против AI', {
    fontFamily: 'Arial',
    fontSize: 32,
    fill: 0x000000,
    fontWeight: 'bold'
  });
  // Draw background for button
  // Helper to build a rounded rect button with text
  function buildButton(textObj, onClick) {
    const padding = 20;
    const bg = new PIXI.Graphics();
    bg.beginFill(0xffffff);
    bg.drawRoundedRect(-padding, -padding, textObj.width + padding * 2, textObj.height + padding * 2, 10);
    bg.endFill();
    const btn = new PIXI.Container();
    btn.addChild(bg);
    btn.addChild(textObj);
    btn.interactive = true;
    btn.buttonMode = true;
    btn.on('pointerdown', onClick);
    return btn;
  }
  const playBtn = buildButton(playText, () => startMatch({ ai: true, aiLevel: selectedAILevel, characterIndex: selectedCharacterIndex }));
  playBtn.anchor = new PIXI.Point(0.5, 0.5);
  playBtn.x = app.renderer.width / 2;
  playBtn.y = app.renderer.height * 0.57;
  container.addChild(playBtn);
  // Settings button
  const settingsText = new PIXI.Text('Настройки', {
    fontFamily: 'Arial',
    fontSize: 28,
    fill: 0x000000,
    fontWeight: 'bold'
  });
  const settingsBtn = buildButton(settingsText, showSettings);
  settingsBtn.anchor = new PIXI.Point(0.5, 0.5);
  settingsBtn.x = app.renderer.width / 2;
  settingsBtn.y = app.renderer.height * 0.72;
  container.addChild(settingsBtn);

  // Replays button to view saved replays
  const replaysText = new PIXI.Text('Повторы', {
    fontFamily: 'Arial',
    fontSize: 28,
    fill: 0x000000,
    fontWeight: 'bold'
  });
  const replaysBtn = buildButton(replaysText, showReplayList);
  replaysBtn.anchor = new PIXI.Point(0.5, 0.5);
  replaysBtn.x = app.renderer.width / 2;
  replaysBtn.y = app.renderer.height * 0.79;
  container.addChild(replaysBtn);

  // Clear cache button: allows user to delete cached assets and reload. Useful
  // when problems occur with stale content. It invokes the Cache API and
  // triggers a full page reload afterwards.
  const clearText = new PIXI.Text('Очистить кэш', {
    fontFamily: 'Arial',
    fontSize: 24,
    fill: 0x000000,
    fontWeight: 'bold'
  });
  const clearBtn = buildButton(clearText, () => {
    if ('caches' in window) {
      caches.keys().then((keys) => {
        return Promise.all(keys.map((key) => caches.delete(key)));
      }).then(() => {
        location.reload();
      });
    } else {
      location.reload();
    }
  });
  clearBtn.anchor = new PIXI.Point(0.5, 0.5);
  clearBtn.x = app.renderer.width / 2;
  clearBtn.y = app.renderer.height * 0.86;
  container.addChild(clearBtn);
}

// Read settings from localStorage and apply them (quality and
// mobile button size). Should be called at startup and when closing
// the settings menu.
function applySettingsFromStorage() {
  // Button size
  const size = localStorage.getItem('btnSize');
  if (size) {
    document.documentElement.style.setProperty('--btn-size', `${size}px`);
  }
  // Quality
  const qualityName = localStorage.getItem('gfxQuality');
  if (qualityName) {
    // Map names to resolution index
    const names = ['Высокое', 'Среднее', 'Низкое'];
    const idx = names.indexOf(qualityName);
    if (idx >= 0) {
      // Save desired index globally for next match
      window.__desiredQualityIndex = idx;
    }
  }
}

// Display a settings overlay as an HTML element. Provides controls
// for adjusting graphics quality and mobile button size. Values are
// persisted in localStorage.
function showSettings() {
  // Create overlay container
  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.background = 'rgba(0, 0, 0, 0.7)';
  overlay.style.display = 'flex';
  overlay.style.justifyContent = 'center';
  overlay.style.alignItems = 'center';
  overlay.style.zIndex = '1000';
  // Panel
  const panel = document.createElement('div');
  panel.style.background = '#ffffff';
  panel.style.padding = '20px';
  panel.style.borderRadius = '8px';
  panel.style.maxWidth = '90%';
  panel.style.color = '#000000';
  // Title
  const title = document.createElement('h2');
  title.textContent = 'Настройки';
  panel.appendChild(title);
  // Quality
  const names = ['Высокое', 'Среднее', 'Низкое'];
  let currentQualityName = localStorage.getItem('gfxQuality') || 'Высокое';
  let currentIndex = names.indexOf(currentQualityName);
  if (currentIndex < 0) currentIndex = 0;
  const qualityRow = document.createElement('div');
  qualityRow.style.marginTop = '10px';
  qualityRow.textContent = 'Качество графики: ';
  const qualityButton = document.createElement('button');
  qualityButton.textContent = names[currentIndex];
  qualityButton.style.marginLeft = '10px';
  qualityButton.onclick = () => {
    currentIndex = (currentIndex + 1) % names.length;
    qualityButton.textContent = names[currentIndex];
    localStorage.setItem('gfxQuality', names[currentIndex]);
  };
  qualityRow.appendChild(qualityButton);
  panel.appendChild(qualityRow);
  // Button size slider
  const sizeRow = document.createElement('div');
  sizeRow.style.marginTop = '10px';
  sizeRow.textContent = 'Размер кнопок:';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '40';
  slider.max = '100';
  const currentSize = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--btn-size')) || 60;
  slider.value = localStorage.getItem('btnSize') || currentSize;
  slider.oninput = () => {
    const val = slider.value;
    document.documentElement.style.setProperty('--btn-size', `${val}px`);
    localStorage.setItem('btnSize', val);
  };
  slider.style.marginLeft = '10px';
  sizeRow.appendChild(slider);
  panel.appendChild(sizeRow);
  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Закрыть';
  closeBtn.style.marginTop = '20px';
  closeBtn.onclick = () => {
    document.body.removeChild(overlay);
    applySettingsFromStorage();
  };
  panel.appendChild(closeBtn);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}

// Display a first‑time user tutorial. The tutorial explains the basic
// controls and objective of the game. It appears only once per browser
// (controlled by localStorage) and pauses the game until dismissed.
function showTutorial() {
  // Prevent multiple tutorials from stacking
  if (document.getElementById('tutorial-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'tutorial-overlay';
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.background = 'rgba(0, 0, 0, 0.8)';
  overlay.style.display = 'flex';
  overlay.style.flexDirection = 'column';
  overlay.style.justifyContent = 'center';
  overlay.style.alignItems = 'center';
  overlay.style.color = '#ffffff';
  overlay.style.zIndex = '2000';
  // Content container
  const panel = document.createElement('div');
  panel.style.maxWidth = '600px';
  panel.style.padding = '20px';
  panel.style.background = '#222';
  panel.style.borderRadius = '8px';
  panel.style.textAlign = 'left';
  // Heading
  const h = document.createElement('h2');
  h.textContent = 'Добро пожаловать!';
  panel.appendChild(h);
  // Instructions list
  const ul = document.createElement('ul');
  ul.style.listStyle = 'disc';
  ul.style.marginLeft = '20px';
  const addLi = (text) => {
    const li = document.createElement('li');
    li.textContent = text;
    ul.appendChild(li);
  };
  addLi('Цель матча — забить больше голов за 90 секунд.');
  addLi('Управление: ←/→ или A/D — бег, ↑/W/Пробел — прыжок, K — супер‑прыжок.');
  addLi('На мобильных используйте кнопки внизу экрана.');
  addLi('В меню можно выбрать персонажа и сложность AI.');
  addLi('Повторы ваших матчей сохраняются и доступны из меню.');
  panel.appendChild(ul);
  // Start button
  const btn = document.createElement('button');
  btn.textContent = 'Начать игру';
  btn.style.marginTop = '20px';
  btn.style.padding = '10px 20px';
  btn.style.fontSize = '16px';
  btn.onclick = () => {
    localStorage.setItem('tutorialDone', 'true');
    document.body.removeChild(overlay);
  };
  panel.appendChild(btn);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}

// Display a list of saved replays. Each entry shows the date and final
// score and offers buttons to play back the replay at different speeds.
function showReplayList() {
  loadReplays();
  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.background = 'rgba(0, 0, 0, 0.7)';
  overlay.style.display = 'flex';
  overlay.style.justifyContent = 'center';
  overlay.style.alignItems = 'center';
  overlay.style.zIndex = '1500';
  const panel = document.createElement('div');
  panel.style.background = '#fff';
  panel.style.padding = '20px';
  panel.style.borderRadius = '8px';
  panel.style.maxHeight = '80%';
  panel.style.overflowY = 'auto';
  const title = document.createElement('h2');
  title.textContent = 'Повторы матчей';
  panel.appendChild(title);
  if (replays.length === 0) {
    const msg = document.createElement('p');
    msg.textContent = 'Повторов пока нет.';
    panel.appendChild(msg);
  }
  replays.forEach((r, index) => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.alignItems = 'center';
    row.style.marginBottom = '8px';
    const label = document.createElement('span');
    const d = new Date(r.timestamp);
    label.textContent = `${d.toLocaleString()} | ${r.finalScore}`;
    row.appendChild(label);
    // Buttons for different speeds
    const speeds = [0.5, 1.0, 1.5];
    speeds.forEach((s) => {
      const b = document.createElement('button');
      b.textContent = `${s}×`;
      b.style.marginLeft = '4px';
      b.onclick = () => {
        document.body.removeChild(overlay);
        playReplay(r, s);
      };
      row.appendChild(b);
    });
    // Delete button
    const del = document.createElement('button');
    del.textContent = '✕';
    del.style.marginLeft = '4px';
    del.onclick = () => {
      if (confirm('Удалить повтор?')) {
        replays.splice(index, 1);
        saveReplays();
        document.body.removeChild(overlay);
        showReplayList();
      }
    };
    row.appendChild(del);
    panel.appendChild(row);
  });
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Закрыть';
  closeBtn.style.marginTop = '10px';
  closeBtn.onclick = () => {
    document.body.removeChild(overlay);
  };
  panel.appendChild(closeBtn);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}

// Play back a saved replay. The replay data contains a sequence of frames
// captured at roughly 10 Hz. During playback we update the positions of
// the ball and players according to these frames without running the
// physics worker. This provides a deterministic reproduction of the
// recorded match. The `speed` parameter scales the playback rate (e.g.
// 0.5× for slow motion). When the replay finishes the menu is shown.
function playReplay(replay, speed) {
  clearStage();
  // Containers and entities similar to a normal match
  const gameContainer = new PIXI.Container();
  app.stage.addChild(gameContainer);
  const WORLD_WIDTH = 10;
  const WORLD_HEIGHT = 5;
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  // Entities: local constructors for circle/image with outlines. These mirror
  // the ones used in startMatch but are scoped to the replay player. They
  // store radius, outline and sprite so we can recompute scale on resize.
  function makeCircleEntity(radius, fillColor, outlineColor) {
    const container = new PIXI.Container();
    const outline = new PIXI.Graphics();
    const sprite = new PIXI.Graphics();
    container.addChild(outline);
    container.addChild(sprite);
    return { container, outline, sprite, radius, fillColor, outlineColor, isImage: false };
  }
  function makeImageEntity(radius, texture, outlineColor) {
    const container = new PIXI.Container();
    const outline = new PIXI.Graphics();
    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5, 1.0);
    container.addChild(outline);
    container.addChild(sprite);
    return { container, outline, sprite, radius, outlineColor, isImage: true };
  }

  // Function to recompute pixel scales when the viewport changes. It
  // adjusts outlines and sprite scales just like in startMatch.
  function computeScale() {
    const wScale = app.renderer.width / WORLD_WIDTH;
    const hScale = app.renderer.height / WORLD_HEIGHT;
    scale = Math.min(wScale, hScale);
    offsetX = (app.renderer.width - WORLD_WIDTH * scale) / 2;
    offsetY = (app.renderer.height - WORLD_HEIGHT * scale) / 2;
    // Resize outline if needed
    [ballEntity, player1Entity, player2Entity].forEach((ent) => {
      ent.outline.clear();
      ent.outline.beginFill(ent.outlineColor);
      ent.outline.drawCircle(0, 0, ent.radius * 1.4 * scale);
      ent.outline.endFill();
      if (ent.isImage) {
        const desiredPixels = ent.radius * 2 * scale;
        const baseHeight = ent.sprite.texture.height;
        const newScale = desiredPixels / baseHeight;
        ent.sprite.scale.set(newScale);
      } else {
        ent.sprite.clear();
        ent.sprite.beginFill(ent.fillColor);
        ent.sprite.drawCircle(0, 0, ent.radius * scale);
        ent.sprite.endFill();
      }
    });
  }
  // Create entities using current selected character index; AI opponent uses
  // offset as usual. We use the local constructors defined above.
  const p1Tex = characterTextures[selectedCharacterIndex];
  const p2Tex = characterTextures[(selectedCharacterIndex + 3) % characterTextures.length];
  const ballEntity = makeCircleEntity(0.11, 0xffff00, 0x333333);
  const player1Entity = makeImageEntity(0.3, p1Tex, 0x002244);
  const player2Entity = makeImageEntity(0.3, p2Tex, 0x440000);
  gameContainer.addChild(ballEntity.container);
  gameContainer.addChild(player1Entity.container);
  gameContainer.addChild(player2Entity.container);
  computeScale();
  app.renderer.on('resize', computeScale);
  // Scoreboard and timer
  let currentIndex = 0;
  const scoreText = new PIXI.Text('0 : 0', { fontFamily: 'Arial', fontSize: 32, fill: 0xffffff, fontWeight: 'bold' });
  scoreText.anchor.set(0.5);
  scoreText.x = app.renderer.width / 2;
  scoreText.y = 20;
  app.stage.addChild(scoreText);
  const timerText = new PIXI.Text('0:00', { fontFamily: 'Arial', fontSize: 24, fill: 0xffffff });
  timerText.anchor.set(0.5);
  timerText.x = app.renderer.width / 2;
  timerText.y = 60;
  app.stage.addChild(timerText);
  // Play frames
  const frames = replay.frames;
  const totalFrames = frames.length;
  let elapsed = 0;
  const frameDuration = 100 / speed; // original sampling ~100ms; adjust by speed
  function update() {
    if (currentIndex >= totalFrames) {
      // Replay finished
      app.ticker.remove(update);
      setTimeout(showMenu, 2000);
      return;
    }
    elapsed += app.ticker.deltaMS;
    while (elapsed >= frameDuration && currentIndex < totalFrames) {
      const f = frames[currentIndex];
      elapsed -= frameDuration;
      currentIndex++;
      // Convert world positions to pixel space
      const convert = (pos) => {
        return { x: pos.x * scale, y: (WORLD_HEIGHT - pos.y) * scale };
      };
      const ballP = convert(f.ball);
      const p1P = convert(f.p1);
      const p2P = convert(f.p2);
      ballEntity.container.x = ballP.x;
      ballEntity.container.y = ballP.y;
      player1Entity.container.x = p1P.x;
      player1Entity.container.y = p1P.y;
      player2Entity.container.x = p2P.x;
      player2Entity.container.y = p2P.y;
      // Update camera (centred on ball)
      const viewWidthWorld = app.renderer.width / scale;
      const halfView = viewWidthWorld / 2;
      let camX = f.ball.x;
      if (camX < halfView) camX = halfView;
      if (camX > WORLD_WIDTH - halfView) camX = WORLD_WIDTH - halfView;
      gameContainer.x = offsetX + ((WORLD_WIDTH / 2 - camX) * scale);
      gameContainer.y = offsetY;
      // Score and timer
      scoreText.text = `${f.scoreLeft} : ${f.scoreRight}`;
      const totSec = Math.max(0, Math.ceil(f.timeLeft / 1000));
      const minutes = Math.floor(totSec / 60);
      const seconds = totSec % 60;
      timerText.text = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
  }
  app.ticker.add(update);
}

// Start the game scene. Accepts options; currently only `ai: true`
// indicates that player 2 is controlled by the Rookie AI. Sets up
// physics worker, input handlers, scoreboard, timer and sprites.
function startMatch(options) {
  clearStage();
  // Add a container for all game objects
  const gameContainer = new PIXI.Container();
  app.stage.addChild(gameContainer);
  // World dimensions must match the ones in the physics worker
  const WORLD_WIDTH = 10;
  const WORLD_HEIGHT = 5;
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  function computeScale() {
    // Calculate scale based on viewport size while preserving aspect ratio
    const wScale = app.renderer.width / WORLD_WIDTH;
    const hScale = app.renderer.height / WORLD_HEIGHT;
    scale = Math.min(wScale, hScale);
    offsetX = (app.renderer.width - WORLD_WIDTH * scale) / 2;
    offsetY = (app.renderer.height - WORLD_HEIGHT * scale) / 2;
    // Redraw outlines and inner graphics/sprites to reflect new scale.
    // Ball and players may have different drawing logic. The generic
    // entity object stores references accordingly.
    const entities = [ballEntity, player1Entity, player2Entity];
    entities.forEach((ent) => {
      // Scale and redraw outline
      ent.outline.clear();
      ent.outline.beginFill(ent.outlineColor);
      ent.outline.drawCircle(0, 0, ent.radius * 1.4 * scale);
      ent.outline.endFill();
      if (ent.isImage) {
        // For image‑based entities, adjust sprite scale so that the
        // character’s height equals diameter (2 × radius) in world
        // units. Anchor.y = 1 so the feet stay at the circle’s base.
        const desiredPixels = ent.radius * 2 * scale;
        const baseHeight = ent.sprite.texture.height;
        const newScale = desiredPixels / baseHeight;
        ent.sprite.scale.set(newScale);
      } else {
        // For primitive shapes (ball) redraw circle
        ent.sprite.clear();
        ent.sprite.beginFill(ent.fillColor);
        ent.sprite.drawCircle(0, 0, ent.radius * scale);
        ent.sprite.endFill();
      }
    });
  }
  // Scoreboard and timer
  let scoreLeft = 0;
  let scoreRight = 0;
  let timeLeftMs = 90 * 1000; // 90 seconds main period
  let overtime = false;
  const scoreText = new PIXI.Text('0 : 0', { fontFamily: 'Arial', fontSize: 32, fill: 0xffffff, fontWeight: 'bold' });
  scoreText.anchor.set(0.5);
  scoreText.x = app.renderer.width / 2;
  scoreText.y = 20;
  const timerText = new PIXI.Text('1:30', { fontFamily: 'Arial', fontSize: 24, fill: 0xffffff });
  timerText.anchor.set(0.5);
  timerText.x = app.renderer.width / 2;
  timerText.y = 60;
  app.stage.addChild(scoreText);
  app.stage.addChild(timerText);

  // Particle effect container and storage. Particles are simple
  // coloured circles that disperse on goal events to make the game
  // feel livelier. Each particle has a velocity and a lifetime.
  const particles = [];
  function spawnParticles(x, y, colour) {
    // Reduce particle count on lower quality settings to improve performance.
    const count = qualityIndex === 0 ? 20 : (qualityIndex === 1 ? 10 : 5);
    for (let i = 0; i < count; i++) {
      const g = new PIXI.Graphics();
      g.beginFill(colour);
      g.drawCircle(0, 0, 0.06 * scale);
      g.endFill();
      g.x = x;
      g.y = y;
      gameContainer.addChild(g);
      particles.push({
        gfx: g,
        vx: (Math.random() - 0.5) * 3,
        vy: -Math.random() * 3,
        life: 1.0
      });
    }
  }
  // Sprite creations with simple toon‑outline. Each entity has a
  // background outline drawn slightly larger to create contrast.
  function createEntity(radius, fillColor, outlineColor) {
    const container = new PIXI.Container();
    const outline = new PIXI.Graphics();
    const sprite = new PIXI.Graphics();
    // Draw using current scale; will be redrawn on scale updates
    outline.beginFill(outlineColor);
    outline.drawCircle(0, 0, radius * 1.4 * scale);
    outline.endFill();
    sprite.beginFill(fillColor);
    sprite.drawCircle(0, 0, radius * scale);
    sprite.endFill();
    container.addChild(outline);
    container.addChild(sprite);
    return { container, outline, sprite, radius, fillColor, outlineColor };
  }
  // Helper to create an image‑based entity. It uses a round outline and
  // a sprite from the provided texture. The sprite’s anchor is set such
  // that the character’s feet are near the centre of its physics body.
  function createImageEntity(radius, texture, outlineColor) {
    const container = new PIXI.Container();
    const outline = new PIXI.Graphics();
    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5, 1.0);
    container.addChild(outline);
    container.addChild(sprite);
    return { container, outline, sprite, radius, outlineColor, isImage: true };
  }

  // Primitive entity for ball (circle)
  function createCircleEntity(radius, fillColor, outlineColor) {
    const container = new PIXI.Container();
    const outline = new PIXI.Graphics();
    const sprite = new PIXI.Graphics();
    container.addChild(outline);
    container.addChild(sprite);
    return { container, outline, sprite, radius, fillColor, outlineColor, isImage: false };
  }

  // Instantiate entities before computing scale so that computeScale can
  // correctly access them. The ball uses a simple circle, whereas
  // players are represented by image sprites with rounded outlines.
  const ballEntity = createCircleEntity(0.11, 0xffff00, 0x333333);
  // Determine textures for players: use the selected index for player1 and a
  // different one for player2 (simple AI) by offsetting the index. We
  // wrap indices using modulo to ensure valid indices.
  const p1Tex = characterTextures[options.characterIndex ?? 0];
  const baseIndex = options.characterIndex ?? 0;
  const p2Tex = characterTextures[(baseIndex + 3) % characterTextures.length];
  const player1Entity = createImageEntity(0.3, p1Tex, 0x002244);
  const player2Entity = createImageEntity(0.3, p2Tex, 0x440000);
  gameContainer.addChild(ballEntity.container);
  gameContainer.addChild(player1Entity.container);
  gameContainer.addChild(player2Entity.container);

  // Now that entities are created, compute initial scale and listen for
  // resize events. Without this ordering, computeScale would reference
  // undefined entities and throw.
  computeScale();
  app.renderer.on('resize', computeScale);
  // State from worker
  let latestState = null;
  // Camera tracking along the x-axis with a dead-zone. Start centred.
  let cameraX = WORLD_WIDTH / 2;
  // Spawn the physics worker unless we are in a replay. In replay mode the
  // simulation is driven by recorded frames and no worker is needed. For
  // normal matches we create a new worker per match. The worker is
  // terminated on match end.
  const isReplay = options && options.replay;
  const worker = isReplay ? null : new Worker('physicsWorker.js');
  if (!isReplay) {
    worker.onmessage = function(event) {
      const data = event.data;
      if (data.type === 'state') {
        latestState = data.state;
      } else if (data.type === 'goal') {
        // Determine which side scored and update score
        const scorer = data.scorer;
        if (scorer === 'left') {
          scoreLeft += 1;
          // Spawn blue confetti on left score
          if (latestState && latestState.ball) {
            const pos = latestState.ball;
            const conv = { x: pos.x * scale, y: (WORLD_HEIGHT - pos.y) * scale };
            spawnParticles(conv.x, conv.y, 0x00aaff);
          }
          playGoalSound(0x00aaff);
        } else {
          scoreRight += 1;
          // Spawn red confetti on right score
          if (latestState && latestState.ball) {
            const pos = latestState.ball;
            const conv = { x: pos.x * scale, y: (WORLD_HEIGHT - pos.y) * scale };
            spawnParticles(conv.x, conv.y, 0xff5555);
          }
          playGoalSound(0xff5555);
        }
        updateScoreboard();
        // Golden goal ends match in overtime
        if (overtime) {
          endMatch();
        }
      }
    };
  }
  function updateScoreboard() {
    scoreText.text = `${scoreLeft} : ${scoreRight}`;
  }
  // Input handling
  const playerInput = { left: false, right: false, jump: false, super: false };
  const aiInput = { left: false, right: false, jump: false, super: false };

  // Replay recording: store frames roughly at 10 Hz. Only record when
  // not in replay mode. Each frame stores positions, scores and time.
  const replayFrames = [];
  let recordAccumulator = 0;
  const matchStart = performance.now();

  // AI difficulty parameters for the match. If an AI level is provided
  // explicitly via options.aiLevel, use it, otherwise use the globally
  // selected level. If options.ai is false the second player is
  // controlled by a human (currently unsupported).
  const aiLevelName = options && options.aiLevel ? options.aiLevel : selectedAILevel;
  const aiProfile = aiProfiles[aiLevelName] || aiProfiles['Rookie'];
  let aiDecisionCountdown = 0;
  let aiLastInput = { left: false, right: false, jump: false, super: false };
  // Super‑jump cooldowns for both players (ms). When zero they can be used.
  let superCooldown1 = 0;
  let superCooldown2 = 0;

  // Quality settings: cycle through high/medium/low by pressing Q. This
  // adjusts the renderer’s internal resolution. Higher resolutions
  // yield sharper graphics at the cost of performance. Initialise
  // qualityIndex from a persisted value if present.
  let qualityIndex = typeof window.__desiredQualityIndex === 'number' ? window.__desiredQualityIndex : 0;
  const qualityLevels = [1.0, 0.75, 0.5];
  function applyQuality() {
    const res = qualityLevels[qualityIndex];
    app.renderer.resolution = res;
    app.renderer.resize(window.innerWidth, window.innerHeight);
    computeScale();
  }
  // Keyboard listeners
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  function onKeyDown(e) {
    switch (e.code) {
      case 'ArrowLeft':
      case 'KeyA':
        playerInput.left = true;
        break;
      case 'ArrowRight':
      case 'KeyD':
        playerInput.right = true;
        break;
      case 'Space':
      case 'ArrowUp':
      case 'KeyW':
        playerInput.jump = true;
        break;
      case 'KeyQ':
        qualityIndex = (qualityIndex + 1) % qualityLevels.length;
        applyQuality();
        break;
      case 'KeyK':
        // Player 1 super‑jump (if off cooldown). The physics worker will
        // perform a stronger jump when it receives a 'super' message.
        if (superCooldown1 <= 0 && !isReplay && worker) {
          playerInput.super = true;
          superCooldown1 = 5000; // 5 s cooldown
          worker.postMessage({ type: 'super', id: 1 });
        }
        break;
    }
  }
  function onKeyUp(e) {
    switch (e.code) {
      case 'ArrowLeft':
      case 'KeyA':
        playerInput.left = false;
        break;
      case 'ArrowRight':
      case 'KeyD':
        playerInput.right = false;
        break;
      case 'Space':
      case 'ArrowUp':
      case 'KeyW':
        playerInput.jump = false;
        break;
    }
  }
  // Mobile button listeners
  const btnLeft = document.getElementById('btn-left');
  const btnRight = document.getElementById('btn-right');
  const btnJump = document.getElementById('btn-jump');
  const addMobileListeners = (btn, key) => {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      playerInput[key] = true;
    });
    btn.addEventListener('pointerup', (e) => {
      e.preventDefault();
      playerInput[key] = false;
    });
    btn.addEventListener('pointerleave', (e) => {
      e.preventDefault();
      playerInput[key] = false;
    });
  };
  addMobileListeners(btnLeft, 'left');
  addMobileListeners(btnRight, 'right');
  addMobileListeners(btnJump, 'jump');
  // Update loop
  function update(delta) {
    // Decrement timer
    timeLeftMs -= app.ticker.deltaMS;
    if (!overtime && timeLeftMs <= 0) {
      // Main time expired
      if (scoreLeft === scoreRight) {
        overtime = true;
        timeLeftMs = 30 * 1000; // 30 seconds overtime
      } else {
        endMatch();
        return;
      }
    } else if (overtime && timeLeftMs <= 0) {
      // Overtime expired without golden goal -> sudden death ended
      endMatch();
      return;
    }
    // Update timer display
    const totalSeconds = Math.max(0, Math.ceil(timeLeftMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    timerText.text = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    // Send player input to worker
    if (!isReplay && worker) {
      worker.postMessage({ type: 'input', id: 1, input: playerInput });
      // Reset super flag so that it is sent only once when triggered
      if (playerInput.super) {
        playerInput.super = false;
      }
    }
    // AI control for player 2 if enabled. Reaction time and aim error are
    // governed by the selected AI profile. The AI considers a new
    // decision only when the countdown expires.
    if (!isReplay && options.ai && latestState) {
      const dtMs = app.ticker.deltaMS;
      aiDecisionCountdown -= dtMs;
      // Reduce super cooldown for the AI
      superCooldown2 = Math.max(0, superCooldown2 - dtMs);
      if (aiDecisionCountdown <= 0) {
        aiDecisionCountdown = aiProfile.reactionTime * 1000;
        const ball = latestState.ball;
        const aiBody = latestState[2];
        if (ball && aiBody) {
          // Predict ball position half a second into the future
          const predictionTime = 0.5;
          const predictedX = ball.x + ball.vx * predictionTime;
          // Introduce horizontal aim error based on difficulty. Convert
          // degrees to a fraction of world units (~10 m width). A higher
          // error means less accuracy.
          const err = (Math.random() - 0.5) * 2 * (aiProfile.aimError / 90);
          const targetX = Math.min(Math.max(predictedX + err, 0), WORLD_WIDTH);
          // Determine horizontal movement
          if (Math.abs(targetX - aiBody.x) > 0.05) {
            aiLastInput.left = targetX < aiBody.x;
            aiLastInput.right = targetX > aiBody.x;
          } else {
            aiLastInput.left = false;
            aiLastInput.right = false;
          }
          // Jump when the ball is above the AI and horizontally close
          aiLastInput.jump = (ball.y > aiBody.y + 0.3 && Math.abs(ball.x - aiBody.x) < 0.5);
          // Occasionally trigger super‑jump if available and ball is high
          if (superCooldown2 <= 0 && ball.y > aiBody.y + 1.0 && Math.abs(ball.x - aiBody.x) < 0.6) {
            aiLastInput.super = true;
            superCooldown2 = 7000;
            if (worker) worker.postMessage({ type: 'super', id: 2 });
          } else {
            aiLastInput.super = false;
          }
        }
      }
      // Send AI input (the last computed decision) to the worker
      if (worker) worker.postMessage({ type: 'input', id: 2, input: aiLastInput });
    }
    // Update sprite positions based on latest state and camera
    if (latestState) {
      const convert = (pos) => {
        return {
          x: pos.x * scale,
          y: (WORLD_HEIGHT - pos.y) * scale
        };
      };
      const ballPosWorld = convert(latestState.ball);
      const p1PosWorld = convert(latestState[1]);
      const p2PosWorld = convert(latestState[2]);
      // Dead‑zone camera following the ball along X. If the ball moves
      // outside of a 1 m window around the current camera centre, shift
      // the camera towards it. Clamp so the edges of the world stay in view.
      const focusX = latestState.ball.x;
      const dead = 1.0;
      if (focusX < cameraX - dead) {
        cameraX = focusX + dead;
      } else if (focusX > cameraX + dead) {
        cameraX = focusX - dead;
      }
      const viewWidthWorld = app.renderer.width / scale;
      const halfView = viewWidthWorld / 2;
      cameraX = Math.max(cameraX, halfView);
      cameraX = Math.min(cameraX, WORLD_WIDTH - halfView);
      // Apply camera offset to container
      gameContainer.x = offsetX + ((WORLD_WIDTH / 2 - cameraX) * scale);
      gameContainer.y = offsetY;
      // Set positions of entity containers
      ballEntity.container.x = ballPosWorld.x;
      ballEntity.container.y = ballPosWorld.y;
      player1Entity.container.x = p1PosWorld.x;
      player1Entity.container.y = p1PosWorld.y;
      player2Entity.container.x = p2PosWorld.x;
      player2Entity.container.y = p2PosWorld.y;
    }

    // Update particles (simple GPU‑like effect). Apply gravity and fade
    // over time. Remove finished particles from the scene.
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      // Integrate velocities (units: metres per second) into pixel space
      const dt = app.ticker.deltaMS / 1000;
      p.vy += 9.81 * 0.3 * dt; // mild gravity for confetti
      p.gfx.x += p.vx * scale * dt;
      p.gfx.y += p.vy * scale * dt;
      p.life -= dt;
      p.gfx.alpha = Math.max(0, p.life);
      if (p.life <= 0) {
        gameContainer.removeChild(p.gfx);
        particles.splice(i, 1);
      }
    }

    // Decrease super cooldown for player 1
    if (!isReplay) {
      superCooldown1 = Math.max(0, superCooldown1 - app.ticker.deltaMS);
    }
    // Record replay frame roughly at 10 Hz (every 100 ms) when not in replay mode
    if (!isReplay && latestState) {
      recordAccumulator += app.ticker.deltaMS;
      while (recordAccumulator >= 100) {
        recordAccumulator -= 100;
        // Clone minimal state for the frame. We avoid storing velocities to
        // keep replay size small.
        const frame = {
          ball: { x: latestState.ball.x, y: latestState.ball.y },
          p1: { x: latestState[1].x, y: latestState[1].y },
          p2: { x: latestState[2].x, y: latestState[2].y },
          scoreLeft,
          scoreRight,
          timeLeft: timeLeftMs
        };
        replayFrames.push(frame);
      }
    }
  }
  app.ticker.add(update);
  // When the match ends, remove listeners and show a result screen
  function endMatch() {
    // Clean up worker and listeners
    if (worker) worker.terminate();
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    // Remove mobile listeners (they will be recreated in next match)
    btnLeft.replaceWith(btnLeft.cloneNode(true));
    btnRight.replaceWith(btnRight.cloneNode(true));
    btnJump.replaceWith(btnJump.cloneNode(true));
    // Display result and back to menu after a delay
    clearStage();
    const result = new PIXI.Text(
      scoreLeft === scoreRight ? 'Ничья!' : (scoreLeft > scoreRight ? 'Победа синего!' : 'Победа красного!'),
      { fontFamily: 'Arial', fontSize: 40, fill: 0xffffff, fontWeight: 'bold' }
    );
    result.anchor.set(0.5);
    result.x = app.renderer.width / 2;
    result.y = app.renderer.height / 2;
    app.stage.addChild(result);
    // Persist replay for this match (only for genuine matches, not during
    // replay playback). We store the final score and a copy of the frames.
    if (!isReplay) {
      const record = {
        timestamp: Date.now(),
        aiLevel: aiLevelName,
        finalScore: `${scoreLeft}:${scoreRight}`,
        frames: replayFrames
      };
      replays.push(record);
      saveReplays();
    }
    setTimeout(showMenu, 3000);
  }
}

// Apply persisted UI/graphics settings before starting the game. This
// ensures button sizes and desired quality are initialised from
// localStorage (if the user previously configured them).
applySettingsFromStorage();
// Kick off the boot process
showBoot();

// Register the service worker for offline caching.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then((registration) => {
      // Listen for updates to the service worker.
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // New version available; prompt user
            showUpdatePrompt(newWorker);
          }
        });
      });
    }).catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}

// Show a soft‑reload prompt when a new service worker is waiting. The
// provided worker will become active after calling postMessage({type:'SKIP_WAITING'}).
function showUpdatePrompt(worker) {
  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.bottom = '20px';
  overlay.style.right = '20px';
  overlay.style.background = '#333';
  overlay.style.color = '#fff';
  overlay.style.padding = '10px 15px';
  overlay.style.borderRadius = '4px';
  overlay.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
  overlay.style.zIndex = '2500';
  const text = document.createElement('span');
  text.textContent = 'Доступно обновление';
  overlay.appendChild(text);
  const btn = document.createElement('button');
  btn.textContent = 'Обновить';
  btn.style.marginLeft = '10px';
  btn.onclick = () => {
    worker.postMessage({ type: 'SKIP_WAITING' });
    // Once the worker is activated, reload the page to use new assets
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated') {
        location.reload();
      }
    });
  };
  overlay.appendChild(btn);
  const later = document.createElement('button');
  later.textContent = 'Позже';
  later.style.marginLeft = '5px';
  later.onclick = () => {
    document.body.removeChild(overlay);
  };
  overlay.appendChild(later);
  document.body.appendChild(overlay);
}

// Basic Dev HUD: log FPS once per second. Useful during early
// optimisation but should be replaced with an in‑game HUD later.
setInterval(() => {
  console.log(`FPS: ${app.ticker.FPS.toFixed(1)}`);
}, 1000);