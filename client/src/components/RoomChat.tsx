import { FormEvent, useEffect, useMemo, useState } from 'react';
import { socket } from '../socket';
import { getRoomAccessToken } from '../roomAccess';
import type { ChatMessage, Room, SocketAck } from '../types';
import './FloatingChat.css';
import './RoomChat.css';

type RoomPayload = { room: Room };

function formatMessageTime(value: number) {
  return new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function roomChatTitle(room: Room) {
  return `${room.teamAName} VS ${room.teamBName}`;
}

export default function RoomChat({
  room,
  nickname,
  onError,
  onRoomUpdate,
  onAccessRequired
}: {
  room: Room;
  nickname: string;
  onError: (message: string) => void;
  onRoomUpdate: (room: Room) => void;
  onAccessRequired: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [lastSeenCount, setLastSeenCount] = useState((room.chatMessages || []).length);
  const [text, setText] = useState('');
  const messages: ChatMessage[] = room.chatMessages || [];

  useEffect(() => {
    setOpen(false);
    setLastSeenCount((room.chatMessages || []).length);
    setText('');
  }, [room.id]);

  useEffect(() => {
    if (open) {
      setLastSeenCount(messages.length);
    }
  }, [open, messages.length]);

  const unreadCount = useMemo(() => {
    if (open) return 0;
    return Math.max(0, messages.length - lastSeenCount);
  }, [open, messages.length, lastSeenCount]);

  const sendMessage = (event: FormEvent) => {
    event.preventDefault();
    const cleanText = text.trim();
    if (!cleanText) return;

    onError('');
    socket.emit(
      'chat:room:send',
      { roomId: room.id, nickname, text: cleanText, roomAccessToken: getRoomAccessToken(room.id) },
      (response: SocketAck<RoomPayload>) => {
        if (!response.ok) {
          if (response.error === 'ROOM_PASSWORD_REQUIRED') {
            onAccessRequired();
            return;
          }
          onError(response.error);
          return;
        }

        onRoomUpdate(response.room);
        setLastSeenCount((response.room.chatMessages || []).length);
        setText('');
      }
    );
  };

  return (
    <div className={`floatingChat roomFloatingChat ${open ? 'open' : ''}`}>
      {open && (
        <section className="floatingChatWindow roomFloatingChatWindow" aria-label={`Чат комнаты ${roomChatTitle(room)}`}>
          <header>
            <div>
              <span>ROOM CHAT</span>
              <b>{roomChatTitle(room)}</b>
            </div>
            <button type="button" onClick={() => setOpen(false)}>×</button>
          </header>

          <div className="chatMessages">
            {messages.length === 0 ? (
              <p className="chatEmpty">В комнате пока нет сообщений.</p>
            ) : messages.map((message) => (
              <article className="chatMessage" key={message.id}>
                <div>
                  <b>{message.nickname}</b>
                  <time>{formatMessageTime(message.createdAt)}</time>
                </div>
                <p>{message.text}</p>
              </article>
            ))}
          </div>

          <form className="chatForm" onSubmit={sendMessage}>
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Написать в чат комнаты..."
              maxLength={300}
            />
            <button type="submit">Отправить</button>
          </form>
        </section>
      )}

      <button type="button" className="floatingChatButton roomFloatingChatButton" onClick={() => setOpen((value) => !value)}>
        <span>Чат комнаты</span>
        {unreadCount > 0 && <b>{unreadCount}</b>}
      </button>
    </div>
  );
}
