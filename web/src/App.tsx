import { useEffect, useMemo, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import axios from 'axios';
import { Link, Route, Routes, useNavigate } from 'react-router-dom';

function useAuth() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'));
  const api = useMemo(() => {
    const instance = axios.create({ baseURL: '/api', withCredentials: true });
    instance.interceptors.request.use((cfg) => {
      if (token) cfg.headers = { ...cfg.headers, Authorization: `Bearer ${token}` };
      return cfg;
    });
    return instance;
  }, [token]);
  return { token, setToken, api };
}

function LoginPage({ setToken }: { setToken: (t: string) => void }) {
  const nav = useNavigate();
  const [emailOrUsername, setUser] = useState('admin@example.com');
  const [password, setPass] = useState('AdminPass123!');
  const [error, setError] = useState('');
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const { data } = await axios.post('/api/auth/login', { emailOrUsername, password }, { withCredentials: true });
      if (data.token) localStorage.setItem('token', data.token);
      setToken(data.token);
      nav('/');
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Login failed');
    }
  }
  return (
    <div className="min-h-full grid place-items-center bg-gray-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100">
      <form onSubmit={onSubmit} className="w-full max-w-sm p-6 rounded-2xl shadow bg-white dark:bg-neutral-800 space-y-4">
        <h1 className="text-xl font-semibold">Sign in</h1>
        <input className="w-full px-3 py-2 rounded bg-neutral-100 dark:bg-neutral-700" value={emailOrUsername} onChange={(e) => setUser(e.target.value)} placeholder="Email or username" />
        <input className="w-full px-3 py-2 rounded bg-neutral-100 dark:bg-neutral-700" type="password" value={password} onChange={(e) => setPass(e.target.value)} placeholder="Password" />
        {error && <div className="text-red-500 text-sm">{error}</div>}
        <button className="w-full py-2 rounded bg-blue-600 text-white">Continue</button>
        <div className="text-sm text-right"><Link to="/register" className="underline">Create account</Link></div>
      </form>
    </div>
  );
}

function RegisterPage({ setToken }: { setToken: (t: string) => void }) {
  const nav = useNavigate();
  const [inviteCode, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const { data } = await axios.post('/api/auth/register', { inviteCode, email, username, displayName, password }, { withCredentials: true });
      if (data.token) localStorage.setItem('token', data.token);
      setToken(data.token);
      nav('/');
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Register failed');
    }
  }
  return (
    <div className="min-h-full grid place-items-center bg-gray-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100">
      <form onSubmit={onSubmit} className="w-full max-w-sm p-6 rounded-2xl shadow bg-white dark:bg-neutral-800 space-y-3">
        <h1 className="text-xl font-semibold">Create account</h1>
        <input className="w-full px-3 py-2 rounded bg-neutral-100 dark:bg-neutral-700" value={inviteCode} onChange={(e) => setCode(e.target.value)} placeholder="Invite code" />
        <input className="w-full px-3 py-2 rounded bg-neutral-100 dark:bg-neutral-700" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
        <input className="w-full px-3 py-2 rounded bg-neutral-100 dark:bg-neutral-700" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" />
        <input className="w-full px-3 py-2 rounded bg-neutral-100 dark:bg-neutral-700" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name" />
        <input className="w-full px-3 py-2 rounded bg-neutral-100 dark:bg-neutral-700" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
        {error && <div className="text-red-500 text-sm">{error}</div>}
        <button className="w-full py-2 rounded bg-blue-600 text-white">Create</button>
      </form>
    </div>
  );
}

function ChatPage({ api, token }: { api: ReturnType<typeof axios.create>; token: string | null }) {
  const [me, setMe] = useState<any>(null);
  const [conversations, setConversations] = useState<any[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [dark, setDark] = useState(true);
  const [typing, setTyping] = useState<Record<string, boolean>>({});
  const [onlineMap, setOnlineMap] = useState<Record<string, boolean>>({});
  const socket = useMemo<Socket | null>(() => (token ? io('/', { auth: { token } }) : null), [token]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  useEffect(() => {
    (async () => {
      const { data } = await api.get('/users/me');
      setMe(data);
      const conv = await api.get('/conversations');
      setConversations(conv.data);
      if (conv.data[0]) setCurrentId(conv.data[0].id);
    })();
  }, [api]);

  useEffect(() => {
    if (!currentId) return;
    (async () => {
      const { data } = await api.get(`/messages/${currentId}?take=50`);
      setMessages(data.items);
      socket?.emit('conversation:join', currentId);
    })();
    return () => {
      socket?.emit('conversation:leave', currentId);
    };
  }, [api, currentId, socket]);

  useEffect(() => {
    if (!socket) return;
    const onNew = (m: any) => {
      if (m.conversationId === currentId) setMessages((prev) => [...prev, m]);
      setConversations((prev) => prev.map((c) => (c.id === m.conversationId ? { ...c, messages: [m] } : c)));
    };
    const onEdited = (m: any) => {
      setMessages((prev) => prev.map((x) => (x.id === m.id ? m : x)));
    };
    const onDeleted = (p: any) => {
      setMessages((prev) => prev.filter((x) => x.id !== p.id));
    };
    const onTyping = (p: any) => {
      setTyping((t) => ({ ...t, [p.conversationId]: p.typing }));
    };
    const onPresence = (p: any) => {
      setOnlineMap((m) => ({ ...m, [p.userId]: p.online }));
    };
    socket.on('message:new', onNew);
    socket.on('message:edited', onEdited);
    socket.on('message:deleted', onDeleted);
    socket.on('typing', onTyping);
    socket.on('presence:online', onPresence);
    return () => {
      socket.off('message:new', onNew);
      socket.off('message:edited', onEdited);
      socket.off('message:deleted', onDeleted);
      socket.off('typing', onTyping);
      socket.off('presence:online', onPresence);
    };
  }, [socket, currentId]);

  async function sendMessage() {
    if (!text.trim() || !currentId) return;
    await api.post(`/messages/${currentId}`, { text });
    setText('');
  }

  async function sendMedia(file: File) {
    if (!currentId) return;
    const fd = new FormData();
    fd.append('file', file);
    await api.post(`/messages/${currentId}/media`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  }

  function subtitleFor(c: any) {
    const last = c.messages?.[0];
    if (!last) return '';
    if (last.type === 'IMAGE') return 'Photo';
    if (last.type === 'VOICE') return `Voice${last.durationSeconds ? ` • ${last.durationSeconds}s` : ''}`;
    if (last.type === 'FILE') return 'File';
    return last.text ?? '';
  }

  return (
    <div className="h-full grid grid-cols-[320px_1fr] bg-gray-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100">
      <aside className="border-r border-neutral-200 dark:border-neutral-800 p-2 flex flex-col">
        <div className="flex items-center justify-between p-2">
          <div className="font-semibold">Chats</div>
          <button className="text-sm px-2 py-1 rounded bg-neutral-200 dark:bg-neutral-700" onClick={() => setDark((d) => !d)}>{dark ? 'Light' : 'Dark'}</button>
        </div>
        <div className="overflow-auto space-y-1">
          {conversations.map((c) => {
            const other = c.members?.map((m: any) => m.user).find((u: any) => u.id !== me?.id);
            const isTyping = typing[c.id];
            const online = other ? onlineMap[other.id] : false;
            return (
              <button key={c.id} onClick={() => setCurrentId(c.id)} className={`w-full text-left px-3 py-2 rounded ${currentId===c.id?'bg-blue-600 text-white':'hover:bg-neutral-200 dark:hover:bg-neutral-800'}`}>
                <div className="flex items-center justify-between">
                  <div className="font-medium">{c.name || other?.displayName || 'Direct message'}</div>
                  {online && <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />}
                </div>
                <div className="text-sm opacity-70 truncate">{isTyping ? 'typing…' : subtitleFor(c)}</div>
              </button>
            );
          })}
        </div>
      </aside>
      <main className="flex flex-col h-full">
        <div className="flex-1 overflow-auto p-4 space-y-2">
          {messages.map((m) => {
            const mine = m.senderId === me?.id;
            return (
              <div key={m.id} className={`flex ${mine?'justify-end':'justify-start'}`}>
                <div className={`${mine?'bg-blue-600 text-white':'bg-neutral-200 dark:bg-neutral-800'} rounded-2xl px-3 py-2 max-w-[70%]`}>
                  {m.type === 'IMAGE' && m.thumbnailUrl ? (
                    <img src={m.thumbnailUrl} className="rounded-lg max-w-xs" />
                  ) : m.type === 'FILE' ? (
                    <a href={m.mediaUrl} className="underline" target="_blank">Download file</a>
                  ) : m.type === 'VOICE' ? (
                    <audio controls src={m.mediaUrl} />
                  ) : (
                    <div>{m.text}</div>
                  )}
                  <div className="text-xs opacity-70 mt-1 flex gap-2">
                    <button onClick={async () => { const text = prompt('Edit message', m.text || ''); if (text!=null) await api.patch(`/messages/item/${m.id}`, { text }); }} className="underline">Edit</button>
                    <button onClick={async () => { if (confirm('Delete message?')) await api.delete(`/messages/item/${m.id}`); }} className="underline">Delete</button>
                    <button onClick={async () => { const emoji = prompt('Emoji', '👍'); if (emoji) await api.post(`/messages/item/${m.id}/reactions`, { emoji }); }} className="underline">React</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="p-3 flex gap-2 border-t border-neutral-200 dark:border-neutral-800">
          <input value={text} onChange={(e) => setText(e.target.value)} onFocus={() => currentId && socket?.emit('typing:start', currentId)} onBlur={() => currentId && socket?.emit('typing:stop', currentId)} className="flex-1 px-3 py-2 rounded bg-white dark:bg-neutral-800" placeholder="iMessage" />
          <label className="px-3 py-2 rounded bg-neutral-200 dark:bg-neutral-700 cursor-pointer">
            <input type="file" className="hidden" onChange={(e) => e.target.files && sendMedia(e.target.files[0])} />
            Attach
          </label>
          <button onClick={sendMessage} className="px-4 py-2 rounded bg-blue-600 text-white">Send</button>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  const { token, setToken, api } = useAuth();
  return (
    <Routes>
      {!token ? (
        <>
          <Route path="/" element={<LoginPage setToken={setToken} />} />
          <Route path="/register" element={<RegisterPage setToken={setToken} />} />
        </>
      ) : (
        <Route path="/*" element={<ChatPage api={api} token={token} />} />
      )}
    </Routes>
  );
}


