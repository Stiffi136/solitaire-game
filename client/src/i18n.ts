// UI translations. English is the default language.

export type Lang = 'en' | 'de';
export const LANGS: Lang[] = ['en', 'de'];

const en = {
  loading: 'Loading…',
  error: 'Error: {msg}',
  time: 'Time',
  moves: 'Moves',
  score: 'Score',
  multiplayer: 'Multiplayer',
  help: 'Help',
  settings: 'Settings',
  fullscreen: 'Fullscreen',
  undo: 'Undo',
  newGame: 'New game',
  hint: 'Hint',
  finish: 'Finish',
  cancel: 'Cancel',
  close: 'Close',
  done: 'Done',
  newGameTitle: 'New game?',
  newGameText: 'The current game will be lost.',
  newGameTextOnline: 'The current game will be lost for everyone in the room.',
  winTitle: 'You won!',
  overTitle: 'No moves left',
  overText: 'No useful move is possible any more – not even with the cards in the stock.',
  drawLegend: 'Draw cards',
  fromNextGame: '(from the next game)',
  draw1: '1 card',
  draw3: '3 cards',
  timePenalty: 'Time penalty (−2 points every 10 s)',
  showScore: 'Show score',
  animations: 'Animations',
  language: 'Language',
  helpTitle: 'How to play',
  helpHtml: `<p><b>Goal:</b> Move all cards by suit from ace to king onto the four foundations at the top right (♠ ♥ ♦ ♣).</p>
<ul>
  <li>In the 7 columns, build down in alternating colors (red/black).</li>
  <li>Only a king may go on an empty column.</li>
  <li>Face-up runs can be moved as a whole.</li>
  <li>Click the pile at the top left to draw new cards. When it is empty, the waste pile is turned over.</li>
</ul>
<p><b>Controls:</b> Drag and drop cards – or just tap a card and it jumps to a matching place. <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes a move.</p>
<p><b>Multiplayer:</b> Create a room with 👥 and share the link. Everyone plays the same game together and sees the other players' pointers.</p>`,
  gotIt: 'Got it',
  yourName: 'Your name',
  namePlaceholder: 'e.g. Anna',
  roomCode: 'Room code',
  roomPlaceholder: 'e.g. K7M2Q',
  join: 'Join',
  createRoom: 'Create new room',
  createHint: 'Creating a room takes your current game into the room.',
  room: 'Room',
  inviteLink: 'Invite link',
  copyLink: 'Copy link',
  leaveRoom: 'Leave room',
  wake: 'Connecting… A sleeping server can take up to 1 minute to wake up.',
  st_connecting: 'connecting…',
  st_open: 'connected',
  st_reconnecting: 'connection lost, reconnecting…',
  st_closed: 'disconnected',
  you: '(you)',
  noMoves: 'No moves left.',
  alreadyWon: 'Already won!',
  fullscreenFailed: 'Fullscreen is not available.',
  enterName: 'Please enter a name.',
  enterRoom: 'Please enter a room code.',
  linkCopied: 'Link copied.',
  connectedTo: 'Connected to room {room}',
  playerJoined: '{name} joined',
  invalidRoom: 'Invalid room code',
};

export type Key = keyof typeof en;

const de: Record<Key, string> = {
  loading: 'Lade…',
  error: 'Fehler: {msg}',
  time: 'Zeit',
  moves: 'Züge',
  score: 'Punkte',
  multiplayer: 'Mehrspieler',
  help: 'Hilfe',
  settings: 'Einstellungen',
  fullscreen: 'Vollbild',
  undo: 'Rückgängig',
  newGame: 'Neu starten',
  hint: 'Tipp',
  finish: 'Fertigstellen',
  cancel: 'Abbrechen',
  close: 'Schließen',
  done: 'Fertig',
  newGameTitle: 'Neues Spiel?',
  newGameText: 'Das laufende Spiel geht verloren.',
  newGameTextOnline: 'Das laufende Spiel geht für alle im Raum verloren.',
  winTitle: 'Gewonnen!',
  overTitle: 'Keine Züge mehr',
  overText: 'Es ist kein sinnvoller Zug mehr möglich – auch nicht mit den Karten im Stapel.',
  drawLegend: 'Karten ziehen',
  fromNextGame: '(ab dem nächsten Spiel)',
  draw1: '1 Karte',
  draw3: '3 Karten',
  timePenalty: 'Zeitstrafe (−2 Punkte alle 10 s)',
  showScore: 'Punkte anzeigen',
  animations: 'Animationen',
  language: 'Sprache',
  helpTitle: 'So wird gespielt',
  helpHtml: `<p><b>Ziel:</b> Alle Karten nach Farbe von Ass bis König auf die vier Ablagen oben rechts legen (♠ ♥ ♦ ♣).</p>
<ul>
  <li>In den 7 Spalten legst du absteigend und abwechselnd rot/schwarz an.</li>
  <li>Auf eine leere Spalte darf nur ein König.</li>
  <li>Offene Stapel kannst du als Ganzes verschieben.</li>
  <li>Klick auf den Stapel oben links zieht neue Karten. Ist er leer, wird der Ablagestapel umgedreht.</li>
</ul>
<p><b>Bedienung:</b> Karten ziehen und fallen lassen – oder einfach antippen, dann springt die Karte an einen passenden Platz. <kbd>Strg</kbd>+<kbd>Z</kbd> macht einen Zug rückgängig.</p>
<p><b>Mehrspieler:</b> Über 👥 einen Raum erstellen und den Link teilen. Alle spielen gemeinsam dieselbe Partie und sehen die Zeiger der anderen.</p>`,
  gotIt: 'Alles klar',
  yourName: 'Dein Name',
  namePlaceholder: 'z. B. Anna',
  roomCode: 'Raumcode',
  roomPlaceholder: 'z. B. K7M2Q',
  join: 'Beitreten',
  createRoom: 'Neuen Raum erstellen',
  createHint: 'Beim Erstellen wird dein aktuelles Spiel in den Raum übernommen.',
  room: 'Raum',
  inviteLink: 'Einladungslink',
  copyLink: 'Link kopieren',
  leaveRoom: 'Raum verlassen',
  wake: 'Verbinde… Ein schlafender Server kann bis zu 1 Minute zum Aufwachen brauchen.',
  st_connecting: 'verbinde…',
  st_open: 'verbunden',
  st_reconnecting: 'Verbindung verloren, verbinde neu…',
  st_closed: 'getrennt',
  you: '(du)',
  noMoves: 'Keine Züge mehr möglich.',
  alreadyWon: 'Schon gewonnen!',
  fullscreenFailed: 'Vollbild nicht möglich.',
  enterName: 'Bitte gib einen Namen ein.',
  enterRoom: 'Bitte gib einen Raumcode ein.',
  linkCopied: 'Link kopiert.',
  connectedTo: 'Verbunden mit Raum {room}',
  playerJoined: '{name} ist beigetreten',
  invalidRoom: 'Ungültiger Raumcode',
};

const dicts: Record<Lang, Record<Key, string>> = { en, de };
let lang: Lang = 'en';

export function setLang(l: Lang) {
  lang = LANGS.includes(l) ? l : 'en';
  document.documentElement.lang = lang;
}
export const getLang = () => lang;

/** Translates a key; `{name}` placeholders are filled from `vars`. */
export function t(key: Key, vars: Record<string, string | number> = {}): string {
  return dicts[lang][key].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

/**
 * Fills static texts in the page:
 * data-i18n (text), data-i18n-html (HTML), data-i18n-placeholder, data-i18n-title (title + aria-label).
 */
export function applyStatic(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n as Key); });
  root.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml as Key); });
  root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder as Key); });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    const v = t(el.dataset.i18nTitle as Key);
    el.title = v;
    el.setAttribute('aria-label', v);
  });
}
