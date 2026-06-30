import { FormEvent, useEffect, useState } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import FloatingChat from './components/FloatingChat';
import Hub from './components/Hub';
import ManaLogo from './components/ManaLogo';
import Room from './components/Room';
import TournamentBracket from './pages/TournamentBracket';
import PastTournaments from './pages/PastTournaments';
import TournamentDetail from './pages/TournamentDetail';
import { socket } from './socket';
import type { SocketAck } from './types';
import './App.css';

const NICKNAME_STORAGE_KEY = 'mana-cs2-nickname';
const ADMIN_TOKEN_STORAGE_KEY = 'mana-admin-token';

type AdminCheckPayload = { isAdmin: boolean; admin: { login: string } | null };
type AdminLoginPayload = { token: string; admin: { login: string } };
type MaintenancePayload = { enabled: boolean };

function readSavedNickname() {
  return localStorage.getItem(NICKNAME_STORAGE_KEY) || '';
}

function readAdminToken() {
  return localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || '';
}

export default function App() {
  const [nickname, setNickname] = useState(readSavedNickname);
  const [adminToken, setAdminToken] = useState(readAdminToken);
  const [isAdmin, setIsAdmin] = useState(false);

  const saveNickname = (nextNickname: string) => {
    const cleanNickname = nextNickname.trim();
    localStorage.setItem(NICKNAME_STORAGE_KEY, cleanNickname);
    setNickname(cleanNickname);
  };

  const saveAdminToken = (token: string) => {
    localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
    setAdminToken(token);
    setIsAdmin(true);
  };

  const logoutAdmin = () => {
    const token = adminToken;
    socket.emit('admin:logout', { adminToken: token }, () => undefined);
    localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    setAdminToken('');
    setIsAdmin(false);
  };

  useEffect(() => {
    const token = readAdminToken();
    if (!token) return;
    socket.emit('admin:check', { adminToken: token }, (response: SocketAck<AdminCheckPayload>) => {
      if (!response.ok || !response.isAdmin) {
        localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
        setAdminToken('');
        setIsAdmin(false);
        return;
      }
      setAdminToken(token);
      setIsAdmin(true);
    });
  }, []);

  if (!nickname) {
    return <NicknameGate onSave={saveNickname} />;
  }

  return (
    <BrowserRouter>
      <AppRoutes
        nickname={nickname}
        onNicknameChange={saveNickname}
        isAdmin={isAdmin}
        adminToken={adminToken}
        onAdminLogin={saveAdminToken}
        onAdminLogout={logoutAdmin}
      />
    </BrowserRouter>
  );
}

function AppRoutes({
  nickname,
  onNicknameChange,
  isAdmin,
  adminToken,
  onAdminLogin,
  onAdminLogout
}: {
  nickname: string;
  onNicknameChange: (nickname: string) => void;
  isAdmin: boolean;
  adminToken: string;
  onAdminLogin: (token: string) => void;
  onAdminLogout: () => void;
}) {
  const location = useLocation();
  const isRoomPage = location.pathname.includes('/room/');
  const isAdminPage = location.pathname.startsWith('/admin');
  const [maintenance, setMaintenance] = useState(false);

  useEffect(() => {
    socket.emit('maintenance:get', (response: SocketAck<MaintenancePayload>) => {
      if (response.ok) setMaintenance(response.enabled);
    });
    const onMaintenance = (payload: MaintenancePayload) => setMaintenance(Boolean(payload.enabled));
    socket.on('maintenance:update', onMaintenance);
    return () => {
      socket.off('maintenance:update', onMaintenance);
    };
  }, []);

  if (maintenance && !isAdmin && !isAdminPage) {
    return <TechnicalMode />;
  }

  return (
    <>
      <Routes>
        <Route path="/" element={<Hub game="cs2" nickname={nickname} onNicknameChange={onNicknameChange} isAdmin={isAdmin} adminToken={adminToken} onAdminLogout={onAdminLogout} />} />
        <Route path="/dota" element={<DotaDevelopment />} />
        <Route path="/room/:roomId" element={<Room nickname={nickname} isAdmin={isAdmin} adminToken={adminToken} onAdminLogout={onAdminLogout} />} />
        <Route path="/dota/room/:roomId" element={<DotaDevelopment />} />
        <Route path="/bracket" element={<TournamentBracket game="cs2" isAdmin={isAdmin} onAdminLogout={onAdminLogout} />} />
        <Route path="/dota/bracket" element={<DotaDevelopment />} />
        <Route path="/past" element={<PastTournaments game="cs2" isAdmin={isAdmin} adminToken={adminToken} onAdminLogout={onAdminLogout} />} />
        <Route path="/dota/past" element={<DotaDevelopment />} />
        <Route path="/past/:tournamentId" element={<TournamentDetail game="cs2" isAdmin={isAdmin} onAdminLogout={onAdminLogout} />} />
        <Route path="/dota/past/:tournamentId" element={<DotaDevelopment />} />
        <Route path="/admin" element={<AdminLogin isAdmin={isAdmin} adminToken={adminToken} onAdminLogin={onAdminLogin} onAdminLogout={onAdminLogout} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {!isRoomPage && <FloatingChat nickname={nickname} scope="global" />}
      {isAdmin && <FloatingChat nickname="admin" scope="admin" adminToken={adminToken} />}
    </>
  );
}


function DotaDevelopment() {
  return (
    <main className="nicknameGate technicalGate">
      <section className="loginCard">
        <ManaLogo />
        <h1>Dota 2 в разработке</h1>
        <p className="muted upper">Раздел временно отключён, чтобы не мешать доработке CS2-части сайта. Все основные изменения сейчас идут в CS2 Match Hub.</p>
        <Link className="adminLinkButton" to="/">Вернуться в CS2</Link>
      </section>
    </main>
  );
}

function TechnicalMode() {
  return (
    <main className="nicknameGate technicalGate">
      <section className="loginCard">
        <ManaLogo />
        <h1>Технический режим</h1>
        <p className="muted upper">Сайт временно закрыт для игроков. Админ может войти через /admin и выключить этот режим.</p>
        <Link className="adminLinkButton" to="/admin">Войти в админку</Link>
      </section>
    </main>
  );
}

function NicknameGate({ onSave }: { onSave: (nickname: string) => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const cleanValue = value.trim();

    if (cleanValue.length < 2) {
      setError('Ник должен быть минимум 2 символа');
      return;
    }

    onSave(cleanValue);
  };

  return (
    <main className="nicknameGate">
      <section className="loginCard">
        <ManaLogo />
        <h1>Введи никнейм</h1>
        <p className="muted upper">Ник сохранится на этом компьютере и будет автоматически использоваться в следующих комнатах.</p>
        <form className="loginForm" onSubmit={submit}>
          <input
            autoFocus
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError('');
            }}
            placeholder="Твой ник"
            maxLength={24}
            required
          />
          <button type="submit">Войти в хаб</button>
        </form>
        {error && <p className="errorText">{error}</p>}
      </section>
    </main>
  );
}

function AdminLogin({
  isAdmin,
  adminToken,
  onAdminLogin,
  onAdminLogout
}: {
  isAdmin: boolean;
  adminToken: string;
  onAdminLogin: (token: string) => void;
  onAdminLogout: () => void;
}) {
  const navigate = useNavigate();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [maintenance, setMaintenance] = useState(false);
  const [logs, setLogs] = useState<Array<{ id: string; action: string; actor: string; createdAt: number }>>([]);

  useEffect(() => {
    socket.emit('maintenance:get', (response: SocketAck<MaintenancePayload>) => {
      if (response.ok) setMaintenance(response.enabled);
    });
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError('');

    socket.emit('admin:login', { login: login.trim(), password }, (response: SocketAck<AdminLoginPayload>) => {
      if (!response.ok) {
        setError(response.error);
        return;
      }
      onAdminLogin(response.token);
      navigate('/admin');
    });
  };

  const toggleMaintenance = () => {
    socket.emit('maintenance:set', { adminToken, enabled: !maintenance }, (response: SocketAck<MaintenancePayload>) => {
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setMaintenance(response.enabled);
    });
  };

  const loadLogs = () => {
    socket.emit('admin:logs:get', { adminToken }, (response: SocketAck<{ logs: Array<{ id: string; action: string; actor: string; createdAt: number }> }>) => {
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setLogs(response.logs || []);
    });
  };

  const exportBackup = () => {
    socket.emit('admin:backup:get', { adminToken }, (response: SocketAck<{ backup: unknown }>) => {
      if (!response.ok) {
        setError(response.error);
        return;
      }
      const blob = new Blob([JSON.stringify(response.backup, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mana-backup-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  };


  const clearChats = (scope: 'global' | 'admin' | 'room' | 'all') => {
    const names: Record<typeof scope, string> = {
      global: 'общий чат',
      admin: 'админ-чат',
      room: 'все чаты комнат',
      all: 'все чаты'
    };
    if (!window.confirm(`Очистить ${names[scope]}?`)) return;
    setError('');
    socket.emit('admin:chat:clear', { adminToken, scope }, (response: SocketAck) => {
      if (!response.ok) {
        setError(response.error);
        return;
      }
      loadLogs();
    });
  };

  return (
    <main className="nicknameGate adminGate">
      <section className="loginCard adminLoginCard">
        <ManaLogo />
        <h1>Админ</h1>
        <p className="muted upper">Админ-права проверяются на сервере. Обычные пользователи не могут создавать комнаты и менять результаты.</p>

        {isAdmin ? (
          <div className="adminLoggedBox">
            <b>АДМИН-ПАНЕЛЬ АКТИВНА</b>
            <div className="adminPanelGrid">
              <section className="adminPanelSection">
                <span>Сайт</span>
                <button type="button" onClick={toggleMaintenance}>{maintenance ? 'Выключить технический режим' : 'Включить технический режим'}</button>
                <button type="button" onClick={exportBackup}>Скачать резервную копию</button>
              </section>

              <section className="adminPanelSection">
                <span>Чаты</span>
                <button type="button" className="ghostBtn" onClick={() => clearChats('global')}>Очистить общий чат</button>
                <button type="button" className="ghostBtn" onClick={() => clearChats('admin')}>Очистить админ-чат</button>
                <button type="button" className="ghostBtn" onClick={() => clearChats('room')}>Очистить чаты комнат</button>
              </section>

              <section className="adminPanelSection">
                <span>Переходы</span>
                <Link className="adminLinkButton" to="/">Перейти на CS2</Link>
                <button type="button" className="ghostBtn" disabled>Dota 2 в разработке</button>
                <button type="button" className="ghostBtn" onClick={onAdminLogout}>Выйти из админки</button>
              </section>

              <section className="adminPanelSection adminLogsSection">
                <span>Логи</span>
                <button type="button" className="ghostBtn" onClick={loadLogs}>Обновить логи админа</button>
                <div className="adminLogsBox">
                  {logs.length === 0 ? <p>Нажми «Обновить логи админа», чтобы посмотреть действия.</p> : logs.slice(0, 24).map((log) => (
                    <p key={log.id}><strong>{log.action}</strong> · {log.actor} · {new Date(log.createdAt).toLocaleString('ru-RU')}</p>
                  ))}
                </div>
              </section>
            </div>
          </div>
        ) : (
          <form className="loginForm" onSubmit={submit}>
            <input
              autoFocus
              value={login}
              onChange={(event) => {
                setLogin(event.target.value);
                setError('');
              }}
              placeholder="Логин"
              autoComplete="username"
              required
            />
            <input
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setError('');
              }}
              placeholder="Пароль"
              autoComplete="current-password"
              required
            />
            <button type="submit">Войти как админ</button>
          </form>
        )}

        {error && <p className="errorText">{error}</p>}
        <Link className="adminBackLink" to="/">← Назад на сайт</Link>
      </section>
    </main>
  );
}
