import {
  initAppState,
  subscribe,
  getScreen,
  getConnStatus,
  getGameState,
  getMyPlayerId,
  getPlayerName,
  getRoomId,
  getErrorMsg,
  joinRoom,
} from "./state/appState";
import { renderConnectingScreen } from "./components/screens/connectingScreen";
import { renderLobbyScreen } from "./components/screens/lobbyScreen";
import {
  renderGameScreen,
  destroyGameScreen,
} from "./components/screens/gameScreen";

function render(): void {
  const app = document.getElementById("app") as HTMLElement;
  const state = getGameState();
  const conn = getConnStatus();
  const screen = getScreen();

  if (!state && conn !== "open") {
    destroyGameScreen();
    renderConnectingScreen(app, conn);
    return;
  }

  if (screen === "lobby") {
    destroyGameScreen();
    renderLobbyScreen(app, {
      gameState: state,
      myPlayerId: getMyPlayerId(),
      playerName: getPlayerName(),
      roomId: getRoomId(),
      errorMsg: getErrorMsg(),
      connStatus: conn,
      onJoined: joinRoom,
    });
    return;
  }

  renderGameScreen(app);
}

initAppState();
subscribe(render);
render();
