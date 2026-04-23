import { Routes, Route, Navigate } from 'react-router-dom';
import { LobbyPage } from './components/Lobby/LobbyPage';
import { GamePage } from './components/Game/GamePage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LobbyPage />} />
      <Route path="/room/:code" element={<GamePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
