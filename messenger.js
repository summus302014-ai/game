let messagesSubscription = null;

// Главная функция инициализации раздела Мессенджера
window.initMessenger = async function(container) {
  container.innerHTML = `
    <div class="neon-card" style="display: flex; flex-direction: column; height: 80vh;">
      <div style="border-bottom: 1px solid var(--border-neon); padding-bottom: 12px; margin-bottom: 16px;">
        <h2 style="margin: 0;">Кибер-Чат</h2>
        <span style="font-size: 13px; color: var(--accent-cyan);">● Соединение с сетью активно</span>
      </div>

      <!-- Область вывода сообщений -->
      <div id="messages-box" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; padding-right: 8px; margin-bottom: 16px;">
        <div style="color: var(--text-dim); text-align: center;">Подключение к чату...</div>
      </div>

      <!-- Форма отправки -->
      <form id="chat-form" onsubmit="sendMessage(event)" style="display: flex; gap: 12px;">
        <input type="text" id="message-input" class="neon-input" placeholder="Напишите сообщение..." style="margin-bottom: 0;" autocomplete="off" required>
        <button type="submit" class="action-btn" style="width: auto; padding: 0 24px;">Отправить</button>
      </form>
    </div>
  `;

  // Загружаем существующие сообщения
  await loadMessages();

  // Подключаем слушатель реального времени
  subscribeToRealtimeMessages();
};

// 1. Загрузка историй сообщений
async function loadMessages() {
  const box = document.getElementById('messages-box');
  if (!box) return;

  const { data: messages, error } = await supabase
    .from('messages')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    box.innerHTML = `<div style="color:var(--accent-pink)">Ошибка загрузки чата: ${error.message}</div>`;
    return;
  }

  const { data: { user } } = await supabase.auth.getUser();

  box.innerHTML = '';
  if (messages.length === 0) {
    box.innerHTML = `<div style="color: var(--text-dim); text-align: center;">В чате пока нет сообщений. Напишите первым!</div>`;
  } else {
    messages.forEach(msg => appendMessageToBox(msg, user?.id));
  }
  
  scrollToBottom();
}

// 2. Отправка нового сообщения
async function sendMessage(event) {
  event.preventDefault();
  const input = document.getElementById('message-input');
  const text = input.value.trim();
  if (!text) return;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    alert('Пожалуйста, авторизуйтесь!');
    return;
  }

  input.value = '';

  const { error } = await supabase.from('messages').insert([
    {
      content: text,
      user_id: user.id,
      user_email: user.email
    }
  ]);

  if (error) {
    alert('Не удалось отправить сообщение: ' + error.message);
  }
}

// 3. Подписка на новейшие сообщения в режиме REALTIME
function subscribeToRealtimeMessages() {
  // Отписываемся от старого канала, если переключали вкладки
  if (messagesSubscription) {
    supabase.removeChannel(messagesSubscription);
  }

  messagesSubscription = supabase
    .channel('public:messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
      const box = document.getElementById('messages-box');
      if (!box) return;

      const { data: { user } } = await supabase.auth.getUser();
      
      // Если это первое сообщение в пустом чате — очищаем заглушку
      if (box.children.length === 1 && box.children[0].innerText.includes('В чате пока нет')) {
        box.innerHTML = '';
      }

      appendMessageToBox(payload.new, user?.id);
      scrollToBottom();
    })
    .subscribe();
}

// Функция для отрисовки пузыря сообщения в UI
function appendMessageToBox(msg, currentUserId) {
  const box = document.getElementById('messages-box');
  const isMyMessage = msg.user_id === currentUserId;

  const msgElement = document.createElement('div');
  msgElement.style.cssText = `
    display: flex;
    flex-direction: column;
    align-self: ${isMyMessage ? 'flex-end' : 'flex-start'};
    max-width: 70%;
    background: ${isMyMessage ? 'rgba(168, 85, 247, 0.25)' : 'rgba(15, 23, 42, 0.65)'};
    border: 1px solid ${isMyMessage ? 'var(--accent-purple)' : 'var(--border-neon)'};
    padding: 10px 14px;
    border-radius: ${isMyMessage ? '16px 16px 2px 16px' : '16px 16px 16px 2px'};
    box-shadow: ${isMyMessage ? '0 0 10px rgba(168, 85, 247, 0.2)' : 'none'};
  `;

  const senderName = isMyMessage ? 'Вы' : (msg.user_email ? msg.user_email.split('@')[0] : 'Аноним');
  const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  msgElement.innerHTML = `
    <span style="font-size: 11px; color: ${isMyMessage ? 'var(--accent-pink)' : 'var(--accent-cyan)'}; margin-bottom: 4px; font-weight: 600;">
      ${senderName}
    </span>
    <span style="font-size: 14px; color: #fff; word-break: break-word;">${msg.content}</span>
    <span style="font-size: 10px; color: var(--text-dim); align-self: flex-end; margin-top: 4px;">${time}</span>
  `;

  box.appendChild(msgElement);
}

function scrollToBottom() {
  const box = document.getElementById('messages-box');
  if (box) box.scrollTop = box.scrollHeight;
}
