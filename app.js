// Конфигурация Supabase
const SUPABASE_URL = 'https://rytfzqktytcjsytkxrqn.supabase.co';
const SUPABASE_KEY = 'ТВОЙ_SUPABASE_ANON_KEY';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Проверка сессии при старте
document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    showAppScreen();
  } else {
    showAuthScreen();
  }
});

// Слушатель состояния авторизации
supabase.auth.onAuthStateChange((event, session) => {
  if (session) {
    showAppScreen();
  } else {
    showAuthScreen();
  }
});

function showAuthScreen() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app-screen').classList.add('hidden');
}

function showAppScreen() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');
  
  // Автоматически загружаем первый раздел (Лента)
  const firstBtn = document.querySelector('.nav-btn');
  loadModule('feed', firstBtn);
}

// Вход в систему
async function handleAuth(event) {
  event.preventDefault();
  const email = document.getElementById('auth-email').value;
  const password = document.getElementById('auth-password').value;
  const errorEl = document.getElementById('auth-error');
  errorEl.textContent = '';

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) errorEl.textContent = error.message;
}

// Регистрация
async function handleSignUp() {
  const email = document.getElementById('auth-email').value;
  const password = document.getElementById('auth-password').value;
  const errorEl = document.getElementById('auth-error');
  errorEl.textContent = '';

  if (!email || !password) {
    errorEl.textContent = 'Заполните email и пароль';
    return;
  }

  const { error } = await supabase.auth.signUp({ email, password });
  if (error) {
    errorEl.textContent = error.message;
  } else {
    alert('Проверьте почту для подтверждения аккаунта!');
  }
}

// Выход
async function handleLogout() {
  await supabase.auth.signOut();
}

// ДИНАМИЧЕСКАЯ ЗАГРУЗКА ДИСКРЕТНЫХ JS-МОДУЛЕЙ
const loadedScripts = {};

async function loadModule(moduleName, btnElement) {
  // Подсветка кнопок
  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
  if (btnElement) btnElement.classList.add('active');

  const container = document.getElementById('module-container');
  container.innerHTML = '<div class="neon-card"><p>Загрузка модуля...</p></div>';

  // Если скрипт ещё не был загружен на страницу — загружаем его dynamically
  if (!loadedScripts[moduleName]) {
    try {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `${moduleName}.js`;
        script.onload = () => {
          loadedScripts[moduleName] = true;
          resolve();
        };
        script.onerror = () => reject(new Error(`Не удалось загрузить ${moduleName}.js`));
        document.body.appendChild(script);
      });
    } catch (err) {
      container.innerHTML = `<div class="neon-card"><p style="color:var(--accent-pink)">Ошибка загрузки модуля: ${err.message}</p></div>`;
      return;
    }
  }

  // Вызываем функцию инициализации из загруженного JS-файла
  const initFuncName = `init${moduleName.charAt(0).toUpperCase() + moduleName.slice(1)}`;
  if (typeof window[initFuncName] === 'function') {
    window[initFuncName](container);
  }
}
