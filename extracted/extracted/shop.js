import { SHOP_ITEMS, buyItem, loadShopState, selectTheme } from './shop-core.js';

const coinsEl = document.getElementById('shop-coins');
const itemsEl = document.getElementById('shop-items');
const bgEl = document.getElementById('bgPieces');
const pieces = ['♔','♕','♖','♗','♘','♙','♚','♛','♜','♝','♞','♟'];

for (let i = 0; i < 24; i++) {
  const el = document.createElement('div');
  el.className = 'bg-piece';
  el.textContent = pieces[Math.floor(Math.random() * pieces.length)];
  el.style.cssText = `left:${Math.random()*100}%;font-size:${2+Math.random()*3}rem;animation-duration:${12+Math.random()*20}s;animation-delay:${-Math.random()*20}s;`;
  bgEl.appendChild(el);
}

function render() {
  const state = loadShopState();
  coinsEl.textContent = String(state.coins);
  itemsEl.innerHTML = '';

  SHOP_ITEMS.forEach(item => {
    const owned = state.owned.includes(item.id);
    const selected = state.selectedTheme === item.id;
    const card = document.createElement('article');
    card.className = 'feat-card visible shop-card';
    card.innerHTML = `
      <div class="shop-preview">
        <span style="background:${item.preview[0]}"></span>
        <span style="background:${item.preview[1]}"></span>
        <span style="background:${item.preview[2]}"></span>
        <span style="background:${item.preview[3]}"></span>
      </div>
      <div class="feat-title">${item.name}</div>
      <p class="feat-desc">${item.description}</p>
      <div class="shop-price">${item.price === 0 ? 'Free' : item.price + ' coins'}</div>
      <div class="shop-actions"></div>
    `;

    const actions = card.querySelector('.shop-actions');
    const button = document.createElement('button');
    button.type = 'button';

    if (!owned) {
      button.className = 'btn-primary';
      button.textContent = 'Buy';
      button.disabled = state.coins < item.price;
      button.addEventListener('click', () => {
        buyItem(item.id);
        render();
      });
    } else if (!selected) {
      button.className = 'btn-secondary';
      button.textContent = 'Equip';
      button.addEventListener('click', () => {
        selectTheme(item.id);
        render();
      });
    } else {
      button.className = 'ghost-btn';
      button.textContent = 'Equipped';
      button.disabled = true;
    }

    actions.appendChild(button);
    itemsEl.appendChild(card);
  });
}

render();
