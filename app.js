import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://ksuylxmmmwaanzbjauhl.supabase.co';
const SUPABASE_KEY = 'sb_publishable_okf2cCPJpbGI4uivNuWrnA_jw1Nki65';   
const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { storage: window.sessionStorage, storageKey: 'royalchat-v4-session',
    persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});
const el = id => document.getElementById(id);
let me = null, people = [], chats = [], allMessages = [], activeChat = null, friend = null;
let messageChannel = null, profileChannel = null, busy = false, mode = 'login', switching = false;
let intervalId = null, fetchInProgress = false, fetchAgain = false;
const readTimes = new Map();
const lastRenderedIds = new Set();
const errorText = e => e?.message || 'Something went wrong';
const initials = name => (name || '?').trim().slice(0, 1).toUpperCase();
const time = d => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const shortDate = d => new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
function toast(text) { const node = el('toast'); node.textContent = text; node.style.display = 'block'; setTimeout(() => { if (node.textContent === text) node.style.display = 'none'; }, 5000); }
function authError(text) { el('joinError').textContent = text; }
function switchMode(value) {
  mode = value;
  el('nameInput').classList.toggle('hidden', value !== 'signup');
  el('nameLabel').classList.toggle('hidden', value !== 'signup');
  el('nameInput').required = value === 'signup';
  el('joinBtn').textContent = value === 'signup' ? 'Create account' : 'Log in';
  el('loginTab').classList.toggle('selected', value === 'login');
  el('signupTab').classList.toggle('selected', value === 'signup');
  authError('');
}
el('loginTab').onclick = () => switchMode('login');
el('signupTab').onclick = () => switchMode('signup');
function showApp() {
  el('welcome').classList.add('hidden'); el('app').classList.remove('hidden');
  el('myName').textContent = me.display_name; el('myAvatar').textContent = initials(me.display_name);
}
function showWelcome() {
  el('welcome').classList.remove('hidden'); el('app').classList.add('hidden');
  el('app').classList.remove('show-chat');
  el('conversation').classList.add('hidden'); el('emptyState').classList.remove('hidden');
}
async function readProfile(userId) {
  const { data, error } = await db.from('rc_profiles').select('id,display_name').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}
async function activateUser(userId) {
  let profile = await readProfile(userId);
  if (!profile) {
    const { data: authData, error: authErrorResult } = await db.auth.getUser();
    if (authErrorResult) throw authErrorResult;

    // Older accounts may have no name saved in authentication metadata.
    let suggestedName = authData.user?.user_metadata?.display_name?.trim() || '';
    while (!profile) {
      const enteredName = window.prompt(
        'Your account is verified, but your RoyalChat profile is missing.\nEnter a unique display name to continue:',
        suggestedName
      );
      if (enteredName === null) throw new Error('Profile setup cancelled. Log in again to finish it.');
      const name = enteredName.trim();
      if (name.length < 2 || name.length > 40) {
        window.alert('Please enter a name between 2 and 40 characters.');
        continue;
      }
      const { error: insertError } = await db.from('rc_profiles').insert({
        id: userId,
        display_name: name
      });
      if (insertError) {
        if (insertError.code === '23505') {
          // A concurrent session may have already created this profile.
          profile = await readProfile(userId);
          if (profile) break;
          suggestedName = name;
          window.alert('That display name is already in use. Choose a different one.');
          continue;
        }
        throw insertError;
      }
      const { error: metadataError } = await db.auth.updateUser({
        data: { display_name: name }
      });
      if (metadataError) console.warn('Could not update display name metadata:', metadataError.message);
      profile = await readProfile(userId);
      if (!profile) throw new Error('Profile could not be loaded after creation.');
    }
  }
  me = profile; showApp();
  if (intervalId) clearInterval(intervalId);
  await refreshAll();
  if (profileChannel) await db.removeChannel(profileChannel);
  profileChannel = db.channel('rc-v4-profiles').on('postgres_changes', {
    event: 'INSERT', schema: 'public', table: 'rc_profiles'
  }, () => refreshAll()).subscribe();
  intervalId = setInterval(refreshAll, 4000);
}
el('authForm').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  busy = true; el('joinBtn').disabled = true; authError('');
  const email = el('emailInput').value.trim();
  const password = el('passwordInput').value;
  const displayName = el('nameInput').value.trim();
  try {
    if (mode === 'signup') {
      if (displayName.length < 2) throw new Error('Enter a name with at least 2 characters.');
      // Sign up FIRST. The rc_profiles table is intentionally not readable by anon users.
      const { data, error } = await db.auth.signUp({
        email, password,
        options: { data: { display_name: displayName } }
      });
      if (error) throw error;
      if (!data.session) {
        throw new Error('Check your email to confirm your account, then log in. Your profile will be created on first login.');
      }
      const { error: createError } = await db.from('rc_profiles')
        .insert({ id: data.user.id, display_name: displayName });
      if (createError) {
        if (createError.code === '23505') {
          throw new Error('That display name is taken. Try another name or contact the administrator to change your profile name.');
        }
        throw createError;
      }
      await activateUser(data.user.id);
    } else {
      const { data, error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await activateUser(data.user.id);
    }
  } catch (error) { authError(errorText(error)); }
  finally { busy = false; el('joinBtn').disabled = false; }
});

function getChatWith(profileId) {
  return chats.find(c => (c.user_a === me.id && c.user_b === profileId) ||
    (c.user_b === me.id && c.user_a === profileId));
}
function chatMessages(chatId) {
  return allMessages.filter(m => m.conversation_id === chatId)
    .sort((a,b) => new Date(a.created_at)-new Date(b.created_at) || a.id.localeCompare(b.id));
}
function readKey(chatId) { return 'royalchat-read-' + me.id + '-' + chatId; }
function getRead(chatId) { return readTimes.get(chatId) || localStorage.getItem(readKey(chatId)) || '1970-01-01T00:00:00.000Z'; }
function markRead(chatId) { const value = new Date().toISOString(); readTimes.set(chatId, value); localStorage.setItem(readKey(chatId), value); }
function unreadCount(chatId) {
  const since = getRead(chatId);
  return chatMessages(chatId).filter(m => m.sender_id !== me.id && m.created_at > since).length;
}
function renderPeople() {
  if (!me) return;
  const query = el('userSearch').value.trim().toLowerCase();
  const list = el('people'); list.replaceChildren();
  const entries = people.filter(p => p.display_name.toLowerCase().includes(query)).map(p => {
    const chat = getChatWith(p.id);
    const latest = chat ? chatMessages(chat.id).at(-1) : null;
    return {p,chat,latest};
  }).sort((a,b) => {
    const aTime = a.latest?.created_at || a.chat?.created_at || '';
    const bTime = b.latest?.created_at || b.chat?.created_at || '';
    return bTime.localeCompare(aTime) || a.p.display_name.localeCompare(b.p.display_name);
  });
  if (!entries.length) {
    const node = document.createElement('p'); node.className = 'empty-list';
    node.textContent = 'No contacts found. Create a second account with a different email and name.';
    list.append(node); return;
  }
  for (const {p,chat,latest} of entries) {
    const item = document.createElement('button');
    item.className = 'person' + (friend?.id === p.id ? ' active' : '');
    const avatar = document.createElement('span'); avatar.className = 'avatar'; avatar.textContent = initials(p.display_name);
    const details = document.createElement('span'); details.className = 'person-details';
    const name = document.createElement('b'); name.textContent = p.display_name;
    const preview = document.createElement('small'); preview.className = 'preview';
    preview.textContent = latest ? (latest.sender_id === me.id ? 'You: ' : '') + latest.body : 'Start a conversation';
    details.append(name, preview); item.append(avatar, details);
    if (latest) {
      const aside = document.createElement('span'); aside.className = 'person-aside';
      const when = document.createElement('small'); when.className = 'person-time'; when.textContent = shortDate(latest.created_at);
      aside.append(when);
      const count = unreadCount(chat.id);
      if (count) { const pill = document.createElement('span'); pill.className = 'unread-count'; pill.textContent = count > 99 ? '99+' : String(count); aside.append(pill); }
      item.append(aside);
    }
    item.onclick = () => openChat(p);
    list.append(item);
  }
}
function renderMessages() {
  const container = el('messages'); container.replaceChildren();
  if (!activeChat) return;
  const msgs = chatMessages(activeChat.id);
  if (!msgs.length) { const p = document.createElement('p'); p.className='empty-list'; p.textContent='Say hello!'; container.append(p); }
  for (const msg of msgs) {
    const div = document.createElement('div'); div.className = 'message' + (msg.sender_id === me.id ? ' mine' : '');
    const body = document.createElement('p'); body.textContent = msg.body;
    const stamp = document.createElement('small'); stamp.textContent = time(msg.created_at);
    div.append(body, stamp); container.append(div);
  }
  container.scrollTop = container.scrollHeight;
  markRead(activeChat.id);
}
async function refreshAll() {
  if (!me) return;
  if (fetchInProgress) { fetchAgain = true; return; }
  fetchInProgress = true;
  try {
    const [pResult, cResult] = await Promise.all([
      db.from('rc_profiles').select('id,display_name').order('display_name'),
      db.from('rc_conversations').select('id,user_a,user_b,created_at')
    ]);
    if (pResult.error) throw pResult.error;
    if (cResult.error) throw cResult.error;
    people = pResult.data.filter(p => p.id !== me.id);
    chats = cResult.data;
    const ids = chats.map(c => c.id);
    if (ids.length) {
      const {data, error} = await db.from('rc_messages')
        .select('id,conversation_id,sender_id,body,created_at')
        .in('conversation_id', ids).order('created_at', {ascending:false}).limit(500);
      if (error) throw error;
      const indexed = new Map(allMessages.map(m => [m.id,m]));
      data.forEach(m => indexed.set(m.id,m));
      allMessages = [...indexed.values()].filter(m => ids.includes(m.conversation_id));
    } else allMessages = [];
    if (activeChat) renderMessages();
    renderPeople();
  } catch (error) { console.error('RoyalChat refresh failed', error); toast(errorText(error)); }
  finally {
    fetchInProgress = false;
    if (fetchAgain) { fetchAgain = false; refreshAll(); }
  }
}
async function getConversation(person) {
  const existing = getChatWith(person.id);
  if (existing) return existing;
  const [user_a,user_b] = [me.id,person.id].sort();
  const {data,error} = await db.from('rc_conversations')
    .upsert({user_a,user_b},{onConflict:'user_a,user_b',ignoreDuplicates:true})
    .select('id,user_a,user_b,created_at');
  if (error) throw error;
  if (data?.[0]) { chats.push(data[0]); return data[0]; }
  const found = await db.from('rc_conversations').select('id,user_a,user_b,created_at')
    .eq('user_a',user_a).eq('user_b',user_b).single();
  if (found.error) throw found.error;
  chats.push(found.data); return found.data;
}
async function openChat(person) {
  try {
    friend = person; const next = await getConversation(person);
    if (messageChannel) { await db.removeChannel(messageChannel); messageChannel = null; }
    activeChat = next;
    el('friendName').textContent = person.display_name;
    el('friendAvatar').textContent = initials(person.display_name);
    el('liveStatus').textContent = 'Connecting...';
    el('emptyState').classList.add('hidden'); el('conversation').classList.remove('hidden');
    el('app').classList.add('show-chat');
    messageChannel = db.channel('rc-v4-' + next.id).on('postgres_changes', {
      event: 'INSERT', schema:'public', table:'rc_messages', filter:`conversation_id=eq.${next.id}`
    }, payload => {
      if (!allMessages.some(m => m.id === payload.new.id)) allMessages.push(payload.new);
      renderMessages(); renderPeople();
    }).subscribe(status => {
      if (activeChat?.id === next.id) {
        el('liveStatus').textContent = status === 'SUBSCRIBED' ? 'Connected · Live' : 'Syncing...';
      }
    });
    await refreshAll();
    renderMessages(); renderPeople();
    el('messageInput').focus();
  } catch (error) { toast(errorText(error)); }
}
el('sendForm').addEventListener('submit', async e => {
  e.preventDefault();
  const body = el('messageInput').value.trim(); if (!body || !me || !activeChat) return;
  const chatId = activeChat.id; el('sendBtn').disabled = true;
  try {
    const {data,error} = await db.from('rc_messages').insert({ conversation_id:chatId, sender_id:me.id, body })
      .select('id,conversation_id,sender_id,body,created_at').single();
    if (error) throw error;
    if (!allMessages.some(m => m.id === data.id)) allMessages.push(data);
    el('messageInput').value = '';
    renderMessages(); renderPeople();
  } catch (error) { toast(errorText(error)); }
  finally { el('sendBtn').disabled = false; el('messageInput').focus(); }
});
el('userSearch').addEventListener('input', renderPeople);
el('refreshBtn').onclick = refreshAll;
el('backBtn').onclick = () => el('app').classList.remove('show-chat');
el('leaveBtn').onclick = async () => {
  if (intervalId) clearInterval(intervalId);
  if (messageChannel) await db.removeChannel(messageChannel);
  if (profileChannel) await db.removeChannel(profileChannel);
  const {error} = await db.auth.signOut();
  if (error) { toast(errorText(error)); return; }
  me = null; friend = null; activeChat = null; chats = []; people = []; allMessages = [];
  messageChannel = null; profileChannel = null; readTimes.clear(); showWelcome();
};
window.addEventListener('focus', () => { if (me) refreshAll(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && me) refreshAll(); });
async function restore() {
  try {
    const {data,error} = await db.auth.getUser();
    if (!error && data.user) await activateUser(data.user.id);
  } catch (error) { console.error('Restore failed', error); authError(errorText(error)); }
}
restore();
