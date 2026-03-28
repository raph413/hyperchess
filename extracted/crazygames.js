let sdkInitPromise = null;
let gameplayActive = false;

function getSdk() {
  return window.CrazyGames?.SDK ?? null;
}

export async function initCrazyGamesSDK() {
  if (sdkInitPromise) return sdkInitPromise;

  sdkInitPromise = (async () => {
    const sdk = getSdk();
    if (!sdk?.init) return false;

    try {
      await sdk.init();
      return true;
    } catch (error) {
      console.warn('CrazyGames SDK init failed:', error);
      return false;
    }
  })();

  return sdkInitPromise;
}

async function callSdk(callback) {
  await initCrazyGamesSDK();
  const sdk = getSdk();
  if (!sdk) return false;

  try {
    await callback(sdk);
    return true;
  } catch (error) {
    console.warn('CrazyGames SDK call failed:', error);
    return false;
  }
}

export async function crazyLoadingStart() {
  return callSdk(sdk => sdk.game.loadingStart());
}

export async function crazyLoadingStop() {
  return callSdk(sdk => sdk.game.loadingStop());
}

export async function crazyGameplayStart() {
  if (gameplayActive) return true;
  const ok = await callSdk(sdk => sdk.game.gameplayStart());
  if (ok) gameplayActive = true;
  return ok;
}

export async function crazyGameplayStop() {
  if (!gameplayActive) return true;
  const ok = await callSdk(sdk => sdk.game.gameplayStop());
  if (ok) gameplayActive = false;
  return ok;
}

export async function crazyHappytime() {
  return callSdk(sdk => sdk.game.happytime());
}

export function preventCrazyPageScroll() {
  window.addEventListener('wheel', event => event.preventDefault(), { passive: false });
  window.addEventListener('keydown', event => {
    if (['ArrowUp', 'ArrowDown', ' '].includes(event.key)) {
      event.preventDefault();
    }
  });
}
