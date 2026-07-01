import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { BrowserRouter, Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import FloatingChat from './components/FloatingChat';
import Hub from './components/Hub';
import ManaLogo from './components/ManaLogo';
import Room from './components/Room';
import TournamentBracket from './pages/TournamentBracket';
import PastTournaments from './pages/PastTournaments';
import TournamentDetail from './pages/TournamentDetail';
import { socket } from './socket';
import { emitWithAck, isAdminAuthError } from './socketAck';
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
  const adminTokenRef = useRef(adminToken);

  useEffect(() => {
    adminTokenRef.current = adminToken;
  }, [adminToken]);

  const saveNickname = (nextNickname: string) => {
    const cleanNickname = nextNickname.trim();
    localStorage.setItem(NICKNAME_STORAGE_KEY, cleanNickname);
    setNickname(cleanNickname);
  };

  const clearAdminState = useCallback(() => {
    localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    adminTokenRef.current = '';
    setAdminToken('');
    setIsAdmin(false);
  }, []);

  const saveAdminToken = useCallback((token: string) => {
    localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
    adminTokenRef.current = token;
    setAdminToken(token);
    setIsAdmin(true);
  }, []);

  const logoutAdmin = useCallback(() => {
    const token = adminTokenRef.current;
    void emitWithAck('admin:logout', { adminToken: token });
    clearAdminState();
  }, [clearAdminState]);

  const validateAdminToken = useCallback((token: string) => {
    if (!token) {
      clearAdminState();
      return;
    }

    void emitWithAck<AdminCheckPayload>('admin:check', { adminToken: token }).then((response) => {
      if (readAdminToken() !== token) return;

      if (!response.ok || !response.isAdmin) {
        clearAdminState();
        return;
      }

      adminTokenRef.current = token;
      setAdminToken(token);
      setIsAdmin(true);
    });
  }, [clearAdminState]);

  useEffect(() => {
    validateAdminToken(readAdminToken());

    const refreshAdmin = () => validateAdminToken(readAdminToken());
    const onStorage = (event: StorageEvent) => {
      if (event.key === ADMIN_TOKEN_STORAGE_KEY) refreshAdmin();
    };
    const onVisibility = () => {
      if (!document.hidden) refreshAdmin();
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', refreshAdmin);
    document.addEventListener('visibilitychange', onVisibility);
    socket.on('connect', refreshAdmin);

    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', refreshAdmin);
      document.removeEventListener('visibilitychange', onVisibility);
      socket.off('connect', refreshAdmin);
    };
  }, [validateAdminToken]);

  return (
    <BrowserRouter>
      <AppRoutes
        nickname={nickname}
        onNicknameChange={saveNickname}
        isAdmin={isAdmin}
        adminToken={adminToken}
        onAdminLogin={saveAdminToken}
        onAdminLogout={logoutAdmin}
        onAdminAuthError={clearAdminState}
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
  onAdminLogout,
  onAdminAuthError
}: {
  nickname: string;
  onNicknameChange: (nickname: string) => void;
  isAdmin: boolean;
  adminToken: string;
  onAdminLogin: (token: string) => void;
  onAdminLogout: () => void;
  onAdminAuthError: () => void;
}) {
  const location = useLocation();
  const isRoomPage = location.pathname.includes('/room/');
  const isAdminPage = location.pathname.startsWith('/admin');
  const isDotaPage = location.pathname.startsWith('/dota');
  const [maintenance, setMaintenance] = useState(false);

  useEffect(() => {
    void emitWithAck<MaintenancePayload>('maintenance:get').then((response) => {
      if (response.ok) setMaintenance(response.enabled);
    });
    const onMaintenance = (payload: MaintenancePayload) => setMaintenance(Boolean(payload.enabled));
    socket.on('maintenance:update', onMaintenance);
    return () => {
      socket.off('maintenance:update', onMaintenance);
    };
  }, []);

  if (!nickname && !isAdminPage) {
    return <NicknameGate onSave={onNicknameChange} />;
  }

  if (maintenance && !isAdmin && !isAdminPage) {
    return <TechnicalMode />;
  }

  const showFloatingChats = Boolean(nickname && !isRoomPage && !isAdminPage && !isDotaPage);

  return (
    <>
      <Routes>
        <Route path="/" element={<Hub game="cs2" nickname={nickname} onNicknameChange={onNicknameChange} isAdmin={isAdmin} adminToken={adminToken} onAdminLogout={onAdminLogout} />} />
        <Route path="/dota" element={<DotaDevelopment />} />
        <Route path="/room/:roomId" element={<Room nickname={nickname} isAdmin={isAdmin} adminToken={adminToken} onAdminLogout={onAdminLogout} />} />
        <Route path="/dota/room/:roomId" element={<DotaDevelopment />} />
        <Route path="/bracket" element={<TournamentBracket game="cs2" isAdmin={isAdmin} adminToken={adminToken} onAdminLogout={onAdminLogout} />} />
        <Route path="/dota/bracket" element={<DotaDevelopment />} />
        <Route path="/past" element={<PastTournaments game="cs2" isAdmin={isAdmin} adminToken={adminToken} onAdminLogout={onAdminLogout} />} />
        <Route path="/dota/past" element={<DotaDevelopment />} />
        <Route path="/past/:tournamentId" element={<TournamentDetail game="cs2" isAdmin={isAdmin} onAdminLogout={onAdminLogout} />} />
        <Route path="/dota/past/:tournamentId" element={<DotaDevelopment />} />
        <Route path="/admin" element={<AdminLogin isAdmin={isAdmin} adminToken={adminToken} onAdminLogin={onAdminLogin} onAdminLogout={onAdminLogout} onAdminAuthError={onAdminAuthError} />} />
        <Route path="*" element={<NotFound />} />
      </Routes>

      {showFloatingChats && <FloatingChat nickname={nickname} scope="global" />}
      {showFloatingChats && isAdmin && <FloatingChat nickname="admin" scope="admin" adminToken={adminToken} />}
    </>
  );
}

function NotFound() {
  return (
    <main className="nicknameGate technicalGate" data-testid="not-found-page">
      <section className="loginCard">
        <ManaLogo />
        <h1>Страница не найдена</h1>
        <p className="muted upper">Такого раздела нет или ссылка устарела.</p>
        <Link className="adminLinkButton" to="/">Вернуться в CS2</Link>
      </section>
    </main>
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
    <main className="nicknameGate technicalGate" data-testid="technical-mode">
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
    <main className="nicknameGate" data-testid="nickname-gate">
      <section className="loginCard">
        <ManaLogo />
        <h1>Введи никнейм</h1>
        <p className="muted upper">Ник сохранится на этом компьютере и будет автоматически использоваться в следующих комнатах.</p>
        <form className="loginForm" onSubmit={submit}>
          <input
            data-testid="nickname-input"
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
          <button type="submit" data-testid="nickname-submit">Войти в хаб</button>
        </form>
        {error && <p className="errorText" role="alert" aria-live="polite">{error}</p>}
      </section>
    </main>
  );
}

function AdminLogin({
  isAdmin,
  adminToken,
  onAdminLogin,
  onAdminLogout,
  onAdminAuthError
}: {
  isAdmin: boolean;
  adminToken: string;
  onAdminLogin: (token: string) => void;
  onAdminLogout: () => void;
  onAdminAuthError: () => void;
}) {
  const navigate = useNavigate();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [maintenance, setMaintenance] = useState(false);
  const [logs, setLogs] = useState<Array<{ id: string; action: string; actor: string; createdAt: number }>>([]);
  const [pending, setPending] = useState('');

  useEffect(() => {
    void emitWithAck<MaintenancePayload>('maintenance:get').then((response) => {
      if (response.ok) setMaintenance(response.enabled);
    });
  }, []);

  const handleAdminError = (message: string) => {
    setError(message);
    if (isAdminAuthError(message)) onAdminAuthError();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (pending) return;

    setPending('login');
    const response = await emitWithAck<AdminLoginPayload>('admin:login', { login: login.trim(), password });
    setPending('');
    if (!response.ok) {
      setError(response.error);
      return;
    }
    onAdminLogin(response.token);
    navigate('/admin');
  };

  const toggleMaintenance = async () => {
    if (pending) return;
    setPending('maintenance');
    const response = await emitWithAck<MaintenancePayload>('maintenance:set', { adminToken, enabled: !maintenance });
    setPending('');
    if (!response.ok) {
      handleAdminError(response.error);
      return;
    }
    setMaintenance(response.enabled);
  };

  const loadLogs = async () => {
    if (pending) return;
    setPending('logs');
    const response = await emitWithAck<{ logs: Array<{ id: string; action: string; actor: string; createdAt: number }> }>('admin:logs:get', { adminToken });
    setPending('');
    if (!response.ok) {
      handleAdminError(response.error);
      return;
    }
    setLogs(response.logs || []);
  };

  const exportBackup = async () => {
    if (pending) return;
    setPending('backup');
    const response = await emitWithAck<{ backup: unknown }>('admin:backup:get', { adminToken });
    setPending('');
    if (!response.ok) {
      handleAdminError(response.error);
      return;
    }
    const blob = new Blob([JSON.stringify(response.backup, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mana-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };


  const clearChats = (scope: 'global' | 'admin' | 'room' | 'all') => {
    const names: Record<typeof scope, string> = {
      global: 'общий чат',
      admin: 'админ-чат',
      room: 'все чаты комнат',
      all: 'все чаты'
    };
    if (!window.confirm(`Очистить ${names[scope]}?`)) return;
    if (pending) return;
    setError('');
    setPending('clearChats');
    void emitWithAck('admin:chat:clear', { adminToken, scope }).then((response: SocketAck) => {
      setPending('');
      if (!response.ok) {
        handleAdminError(response.error);
        return;
      }
      void loadLogs();
    });
  };

  return (
    <main className="nicknameGate adminGate">
      <section className="loginCard adminLoginCard">
        <ManaLogo />
        <h1>Админ</h1>
        <p className="muted upper">Админ-права проверяются на сервере. Обычные пользователи не могут создавать комнаты и менять результаты.</p>

        {isAdmin ? (
          <div className="adminLoggedBox" data-testid="admin-panel">
            <b>АДМИН-ПАНЕЛЬ АКТИВНА</b>
            <div className="adminPanelGrid">
              <section className="adminPanelSection">
                <span>Сайт</span>
                <button type="button" data-testid="maintenance-toggle" disabled={Boolean(pending)} onClick={toggleMaintenance}>{maintenance ? 'Выключить технический режим' : 'Включить технический режим'}</button>
                <button type="button" disabled={Boolean(pending)} onClick={exportBackup}>Скачать резервную копию</button>
              </section>

              <section className="adminPanelSection">
                <span>Чаты</span>
                <button type="button" className="ghostBtn" disabled={Boolean(pending)} onClick={() => clearChats('global')}>Очистить общий чат</button>
                <button type="button" className="ghostBtn" disabled={Boolean(pending)} onClick={() => clearChats('admin')}>Очистить админ-чат</button>
                <button type="button" className="ghostBtn" disabled={Boolean(pending)} onClick={() => clearChats('room')}>Очистить чаты комнат</button>
              </section>

              <section className="adminPanelSection">
                <span>Переходы</span>
                <Link className="adminLinkButton" to="/">Перейти на CS2</Link>
                <button type="button" className="ghostBtn" disabled>Dota 2 в разработке</button>
                <button type="button" className="ghostBtn" data-testid="admin-logout" onClick={onAdminLogout}>Выйти из админки</button>
              </section>

              <section className="adminPanelSection adminLogsSection">
                <span>Логи</span>
                <button type="button" className="ghostBtn" disabled={Boolean(pending)} onClick={loadLogs}>Обновить логи админа</button>
                <div className="adminLogsBox">
                  {logs.length === 0 ? <p>Нажми «Обновить логи админа», чтобы посмотреть действия.</p> : logs.slice(0, 24).map((log) => (
                    <p key={log.id}><strong>{log.action}</strong> · {log.actor} · {new Date(log.createdAt).toLocaleString('ru-RU')}</p>
                  ))}
                </div>
              </section>
            </div>
          </div>
        ) : (
          <form className="loginForm" data-testid="admin-login-form" onSubmit={submit}>
            <input
              data-testid="admin-login-input"
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
              data-testid="admin-password-input"
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
            <button type="submit" data-testid="admin-login-submit" disabled={Boolean(pending)}>{pending === 'login' ? 'Проверяю...' : 'Войти как админ'}</button>
          </form>
        )}

        {error && <p className="errorText" role="alert" aria-live="polite">{error}</p>}
        <Link className="adminBackLink" to="/">← Назад на сайт</Link>
      </section>
    </main>
  );
}
