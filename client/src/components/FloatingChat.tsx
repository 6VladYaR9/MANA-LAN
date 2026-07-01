import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { socket } from '../socket';
import { emitWithAck } from '../socketAck';
import type { ChatMessage } from '../types';
import './FloatingChat.css';

type ChatPayload = { messages: ChatMessage[] };

type ChatScope = 'global' | 'admin';

function formatMessageTime(value: number) {
  return new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function chatTitle(scope: ChatScope) {
  return scope === 'admin' ? 'Админ-чат' : 'Общий чат';
}

function chatEvent(scope: ChatScope, action: 'get' | 'send' | 'update') {
  return `chat:${scope}:${action}`;
}

export default function FloatingChat({
  nickname,
  scope = 'global',
  adminToken = ''
}: {
  nickname: string;
  scope?: ChatScope;
  adminToken?: string;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [lastSeenCount, setLastSeenCount] = useState(0);
  const [text, setText] = useState('');
  const [image, setImage] = useState('');
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void emitWithAck<ChatPayload>(chatEvent(scope, 'get'), { adminToken }).then((response) => {
      if (response.ok) {
        const nextMessages = response.messages || [];
        setMessages(nextMessages);
        setLastSeenCount(nextMessages.length);
      } else {
        setError(response.error);
      }
    });

    const onUpdate = (payload: ChatPayload) => {
      const nextMessages = payload.messages || [];
      setMessages(nextMessages);

      if (open) {
        setLastSeenCount(nextMessages.length);
      }
    };

    socket.on(chatEvent(scope, 'update'), onUpdate);
    return () => {
      socket.off(chatEvent(scope, 'update'), onUpdate);
    };
  }, [open, scope, adminToken]);

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
    if (!cleanText && !image) return;

    setError('');
    void emitWithAck<ChatPayload>(
      chatEvent(scope, 'send'),
      { nickname, text: cleanText, image: scope === 'admin' ? image : '', adminToken }
    ).then((response) => {
        if (!response.ok) {
          setError(response.error);
          return;
        }

        const nextMessages = response.messages || [];
        setMessages(nextMessages);
        setLastSeenCount(nextMessages.length);
        setText('');
        setImage('');
        if (fileInputRef.current) fileInputRef.current.value = '';
      });
  };

  const readImage = (file: File) => {
    if (!file.type.match(/^image\/(png|jpeg|jpg|webp)$/)) {
      setError('Можно прикрепить только PNG, JPG или WEBP.');
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setError('Картинка слишком большая. Лимит 3 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImage(String(reader.result || ''));
    reader.onerror = () => setError('Не удалось прочитать картинку');
    reader.readAsDataURL(file);
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) readImage(file);
  };

  return (
    <div className={`floatingChat ${open ? 'open' : ''} ${scope === 'admin' ? 'adminFloatingChat' : ''}`}>
      {open && (
        <section className="floatingChatWindow" aria-label={chatTitle(scope)}>
          <header>
            <div>
              <span>{scope === 'admin' ? 'ADMIN CHAT' : 'GLOBAL CHAT'}</span>
              <b>{chatTitle(scope)}</b>
            </div>
            <button type="button" onClick={() => setOpen(false)}>×</button>
          </header>

          <div className="chatMessages">
            {messages.length === 0 ? (
              <p className="chatEmpty">Сообщений пока нет. Напиши первым.</p>
            ) : messages.map((message) => (
              <article className="chatMessage" key={message.id}>
                <div>
                  <b>{message.nickname}</b>
                  <time>{formatMessageTime(message.createdAt)}</time>
                </div>
                {message.text && <p>{message.text}</p>}
                {message.image && <img className="chatImage" src={message.image} alt="Изображение из админ-чата" />}
              </article>
            ))}
          </div>

          {error && <p className="chatError">{error}</p>}
          {image && <div className="chatAttachPreview"><img src={image} alt="Предпросмотр" /><button type="button" onClick={() => setImage('')}>Убрать</button></div>}

          <form className="chatForm" onSubmit={sendMessage}>
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={scope === 'admin' ? 'Админ-сообщение, ссылка или заметка...' : 'Написать в общий чат...'}
              maxLength={scope === 'admin' ? 500 : 300}
            />
            {scope === 'admin' && (
              <label className="chatAttachButton" title="Прикрепить картинку">
                +
                <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={onFileChange} />
              </label>
            )}
            <button type="submit">Отправить</button>
          </form>
        </section>
      )}

      <button type="button" className="floatingChatButton" onClick={() => setOpen((value) => !value)}>
        <span>{scope === 'admin' ? 'Админ чат' : 'Чат'}</span>
        {unreadCount > 0 && <b>{unreadCount}</b>}
      </button>
    </div>
  );
}
