export const SHOP_ITEMS = [
  {
    id: 'classic',
    name: 'Classic Clash',
    price: 0,
    description: 'The original HyperChess palette.',
    preview: ['#7FA8C8', '#3A5F85', '#F0D9B5', '#B58863']
  },
  {
    id: 'neon',
    name: 'Neon Circuit',
    price: 120,
    description: 'Arcade greens and electric dark tiles.',
    preview: ['#7CFFB2', '#164B52', '#C5FFE4', '#2D7D6D']
  },
  {
    id: 'ember',
    name: 'Ember Forge',
    price: 180,
    description: 'Hot lava reds mixed with ash stone.',
    preview: ['#F6B26B', '#A84300', '#FFD9B3', '#6C2A00']
  },
  {
    id: 'royal',
    name: 'Royal Velvet',
    price: 250,
    description: 'Gold and deep navy for a premium board.',
    preview: ['#D9C26C', '#2C365E', '#F4E7A1', '#151B38']
  }
];

const STORE_KEY = 'hyperchess-shop-state';
const DEFAULT_STATE = {
  coins: 150,
  owned: ['classic'],
  selectedTheme: 'classic'
};

function isBrowser() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function loadShopState() {
  if (!isBrowser()) {
    return { ...DEFAULT_STATE, owned: [...DEFAULT_STATE.owned] };
  }

  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    return {
      coins: Number.isFinite(parsed?.coins) ? parsed.coins : DEFAULT_STATE.coins,
      owned: Array.isArray(parsed?.owned) && parsed.owned.length ? parsed.owned : [...DEFAULT_STATE.owned],
      selectedTheme: typeof parsed?.selectedTheme === 'string' ? parsed.selectedTheme : DEFAULT_STATE.selectedTheme
    };
  } catch {
    return { ...DEFAULT_STATE, owned: [...DEFAULT_STATE.owned] };
  }
}

export function saveShopState(state) {
  if (!isBrowser()) return;
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

export function rewardCoins(amount) {
  const state = loadShopState();
  state.coins += amount;
  saveShopState(state);
  return state;
}

export function buyItem(itemId) {
  const item = SHOP_ITEMS.find(entry => entry.id === itemId);
  if (!item) return { ok: false, message: 'Item not found.' };

  const state = loadShopState();
  if (state.owned.includes(itemId)) {
    return { ok: false, message: 'Item already owned.', state };
  }
  if (state.coins < item.price) {
    return { ok: false, message: 'Not enough coins.', state };
  }

  state.coins -= item.price;
  state.owned.push(itemId);
  saveShopState(state);
  return { ok: true, state };
}

export function selectTheme(itemId) {
  const state = loadShopState();
  if (!state.owned.includes(itemId)) {
    return { ok: false, message: 'Theme not owned.', state };
  }
  state.selectedTheme = itemId;
  saveShopState(state);
  return { ok: true, state };
}

export function getSelectedTheme() {
  const state = loadShopState();
  return SHOP_ITEMS.find(item => item.id === state.selectedTheme) || SHOP_ITEMS[0];
}
