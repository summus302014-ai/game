window.initFeed = function(container) {
  container.innerHTML = `
    <div class="neon-card">
      <h2>Лента новостей</h2>
      <textarea id="feed-post-text" class="neon-input" rows="3" placeholder="Что происходит в киберпространстве?"></textarea>
      <button class="action-btn" onclick="submitPost()">Опубликовать</button>
    </div>
    
    <div id="posts-list" style="margin-top: 20px;">
      <!-- Сюда подгрузятся посты -->
    </div>
  `;
  
  loadPosts();
};

async function loadPosts() {
  const list = document.getElementById('posts-list');
  if (!list) return;

  const { data: posts, error } = await supabase
    .from('posts')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    list.innerHTML = `<div class="neon-card"><p>Ошибка загрузки постов: ${error.message}</p></div>`;
    return;
  }

  if (!posts || posts.length === 0) {
    list.innerHTML = `<div class="neon-card"><p style="color:var(--text-dim)">Пока нет публикаций. Будьте первым!</p></div>`;
    return;
  }

  list.innerHTML = posts.map(post => `
    <div class="neon-card" style="margin-bottom: 16px;">
      <p>${post.content}</p>
      <span style="font-size: 12px; color: var(--text-dim); margin-top: 8px; display: block;">
        ${new Date(post.created_at).toLocaleString()}
      </span>
    </div>
  `).join('');
}

async function submitPost() {
  const textInput = document.getElementById('feed-post-text');
  const content = textInput.value.trim();
  if (!content) return;

  const { data: { user } } = await supabase.auth.getUser();

  const { error } = await supabase.from('posts').insert([
    { content: content, user_id: user.id }
  ]);

  if (error) {
    alert('Ошибка при создании поста: ' + error.message);
  } else {
    textInput.value = '';
    loadPosts();
  }
}
