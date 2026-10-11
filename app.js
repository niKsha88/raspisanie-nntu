// ==========================================================
// КОНФИГУРАЦИЯ
// ==========================================================
const API_URL = 'https://api.nntu.ru/getschedule';
const WORKER_URL = 'https://nntu-teachers.vika-shilina-06-06.workers.dev';
const GROUP_ID = '846';
const DEPARTMENT_ID = 1;

let currentTab = 'today';
let currentSchedule = null;
let suggestTimer = null;    // для debounce подсказок

const WEEKDAYS = {1: 'Понедельник', 2: 'Вторник', 3: 'Среда', 4: 'Четверг', 5: 'Пятница', 6: 'Суббота', 7: 'Воскресенье'};
const WEEKDAYS_FULL = {1: 'Понедельник', 2: 'Вторник', 3: 'Среда', 4: 'Четверг', 5: 'Пятница', 6: 'Суббота'};

// ==========================================================
// ЗАГРУЗКА РАСПИСАНИЯ СТУДЕНТА
// ==========================================================
async function loadSchedule() {
    const content = document.getElementById('scheduleContent');
    content.innerHTML = '<div class="loading">Загрузка расписания...</div>';
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body: `&department_id=${DEPARTMENT_ID}&group_id=${GROUP_ID}&type=1&date_from=null&date_to=null`
        });
        if (!response.ok) throw new Error('Ошибка API');
        const raw = await response.json();
        currentSchedule = normalizeSchedule(raw);
        localStorage.setItem('schedule_cache', JSON.stringify({
            data: currentSchedule, timestamp: Date.now()
        }));
        render();
    } catch (error) {
        console.error('Ошибка загрузки:', error);
        const cached = localStorage.getItem('schedule_cache');
        if (cached) {
            currentSchedule = JSON.parse(cached).data;
            render();
        } else {
            content.innerHTML = '<div class="empty-day">❌ Не удалось загрузить расписание.</div>';
        }
    }
}

function normalizeSchedule(raw) {
    const result = {};
    for (const [wday, streams] of Object.entries(raw)) {
        const lessons = [];
        const seen = new Set(); // защита от дублей
        if (Array.isArray(streams)) {
            for (const stream of streams) {
                if (!Array.isArray(stream)) continue;
                for (const p of stream) {
                    const surname = p.prepod_surname || '';
                    const name = p.prepod_name || '';
                    const initials = p.prepod_initials || '';
                    const teacher = surname + (name ? ' ' + name[0] + '.' : '') + (initials ? initials[0] + '.' : '');
                    // Уникальный ключ для дедупликации
                    const key = `${p.para}_${p.predmet_name}_${p.aud}_${teacher}_${p.para_type}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    lessons.push({
                        number: parseInt(p.para) || 0,
                        time: p.para_time || '',
                        subject: p.predmet_name || '',
                        type: p.para_type || '',
                        teacher: teacher,
                        room: p.aud || '',
                        comment: p.comment || '',
                        trueTime: p.true_time || 0,
                        isCancelled: (p.comment || '').toLowerCase().includes('не будет')
                    });
                }
            }
        }
        lessons.sort((a, b) => a.number - b.number || a.type.localeCompare(b.type));
        result[wday] = lessons;
    }
    return result;
}

function render() {
    const content = document.getElementById('scheduleContent');
    if (!currentSchedule) {
        content.innerHTML = '<div class="loading">Загрузка...</div>';
        return;
    }
    if (currentTab === 'today' || currentTab === 'tomorrow') {
        const targetDate = currentTab === 'today' ? new Date() : new Date(Date.now() + 86400000);
        const wday = targetDate.getDay() === 0 ? 7 : targetDate.getDay();
        const lessons = currentSchedule[wday] || [];
        const title = currentTab === 'today' ? 'Сегодня' : 'Завтра';
        content.innerHTML = renderDay(lessons, `${title}, ${targetDate.toLocaleDateString('ru-RU')} (${WEEKDAYS[wday] || ''})`);
    } else {
        let html = '';
        for (let wday = 1; wday <= 6; wday++) {
            const lessons = currentSchedule[wday] || [];
            if (lessons.length > 0) html += renderDay(lessons, WEEKDAYS[wday]);
        }
        content.innerHTML = html || '<div class="empty-day">🎉 На неделе пар нет!</div>';
    }
}

function renderDay(lessons, header) {
    if (!lessons || lessons.length === 0) {
        return `<div class="day-header">${header}</div><div class="empty-day">🎉 Пар нет!</div>`;
    }
    let html = `<div class="day-header">${header}</div>`;
    for (const l of lessons) {
        const cancelClass = l.isCancelled ? ' cancelled' : '';
        const room = l.room ? `<span>🚪 ауд. ${l.room}</span>` : '';
        html += `
            <div class="lesson-card${cancelClass}">
                <div class="lesson-time">🕐 ${l.time} (${l.number} пара) — ${l.type}</div>
                <div class="lesson-subject">${l.subject}</div>
                <div class="lesson-details">
                    <span>👤 ${l.teacher}</span>
                    ${room}
                </div>
                ${l.comment && !l.isCancelled ? `<div class="lesson-comment">💬 ${l.comment}</div>` : ''}
                ${l.isCancelled ? '<div class="lesson-comment">❌ ОТМЕНА</div>' : ''}
            </div>
        `;
    }
    return html;
}

// ==========================================================
// ОБРАБОТЧИКИ КНОПОК
// ==========================================================
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentTab = tab.dataset.day;
        render();
    });
});

document.getElementById('refreshBtn').addEventListener('click', loadSchedule);
document.getElementById('settingsBtn').addEventListener('click', () => {
    alert('⚙️ Настройки\n\nЗдесь можно будет:\n• Сменить группу\n• Настроить уведомления\n• Включить push\n\n(В разработке)');
});
document.getElementById('teacherBtn').addEventListener('click', showTeacherSearch);

// ==========================================================
// ПОИСК ПРЕПОДАВАТЕЛЯ + АВТОДОПОЛНЕНИЕ
// ==========================================================
function showTeacherSearch() {
    const content = document.getElementById('scheduleContent');
    content.innerHTML = `
        <div class="day-header">👨‍🏫 Расписание преподавателя</div>
        <div style="padding: 12px 0; position: relative;">
            <input type="text" id="teacherQuery" placeholder="Начните вводить фамилию..." 
                   autocomplete="off"
                   style="width: 100%; padding: 12px; border-radius: 8px; 
                          border: 1px solid #2a2a4a; background: #16213e; 
                          color: #eaeaea; font-size: 16px; box-sizing: border-box;">
            <div id="teacherSuggestions" 
                 style="position: absolute; left: 0; right: 0; top: 100%; 
                        background: #16213e; border: 1px solid #2a2a4a; 
                        border-radius: 8px; margin-top: 4px; max-height: 240px; 
                        overflow-y: auto; z-index: 100; display: none;">
            </div>
            <button id="teacherSearchBtn" 
                    style="margin-top: 10px; width: 100%; padding: 12px; 
                           border-radius: 8px; border: none; background: #0f3460; 
                           color: white; font-size: 16px; cursor: pointer;">
                🔍 Найти
            </button>
        </div>
        <div id="teacherResults"></div>
    `;

    const input = document.getElementById('teacherQuery');
    const suggestions = document.getElementById('teacherSuggestions');

    // Автоподсказки при вводе (с задержкой 250 мс)
    input.addEventListener('input', () => {
        clearTimeout(suggestTimer);
        const q = input.value.trim();
        if (q.length < 1) {
            suggestions.style.display = 'none';
            suggestions.innerHTML = '';
            return;
        }
        suggestTimer = setTimeout(() => fetchSuggestions(q), 250);
    });

    // Скрываем подсказки при клике вне
    document.addEventListener('click', (e) => {
        if (!suggestions.contains(e.target) && e.target !== input) {
            suggestions.style.display = 'none';
        }
    });

    document.getElementById('teacherSearchBtn').addEventListener('click', searchTeacher);
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            suggestions.style.display = 'none';
            searchTeacher();
        }
    });
}

// Получить подсказки для автодополнения
async function fetchSuggestions(query) {
    const suggestions = document.getElementById('teacherSuggestions');
    try {
        const response = await fetch(`${WORKER_URL}/teacher?name=${encodeURIComponent(query)}`);
        const data = await response.json();
        const teachers = (data.teachers || []).slice(0, 15);
        if (teachers.length === 0) {
            suggestions.style.display = 'none';
            return;
        }
        suggestions.innerHTML = teachers.map(t => `
            <div class="suggestion-item" 
                 data-name="${t.display.replace(/"/g, '&quot;')}"
                 style="padding: 10px 12px; cursor: pointer; 
                        border-bottom: 1px solid #2a2a4a; color: #eaeaea;">
                <div style="font-size: 15px;">${t.display}</div>
                <div style="font-size: 12px; color: #a0a0b0;">${t.position || ''}</div>
            </div>
        `).join('');
        suggestions.style.display = 'block';

        // Клик по подсказке — сразу показываем расписание
        suggestions.querySelectorAll('.suggestion-item').forEach(el => {
            el.addEventListener('click', () => {
                document.getElementById('teacherQuery').value = el.dataset.name;
                suggestions.style.display = 'none';
                searchTeacher();
            });
        });
    } catch (e) {
        console.error('Suggest error:', e);
    }
}

async function searchTeacher() {
    const query = document.getElementById('teacherQuery').value.trim();
    const results = document.getElementById('teacherResults');
    document.getElementById('teacherSuggestions').style.display = 'none';

    if (query.length < 2) {
        results.innerHTML = '<div class="empty-day">Введите минимум 2 буквы</div>';
        return;
    }
    results.innerHTML = '<div class="loading">🔎 Поиск...</div>';
    try {
        const response = await fetch(`${WORKER_URL}/teacher?name=${encodeURIComponent(query)}`);
        const data = await response.json();
        const teachersList = Array.isArray(data.teachers) ? data.teachers : [];
        if (!teachersList.length) {
            results.innerHTML = '<div class="empty-day">🤷 Никого не нашёл</div>';
            return;
        }
        let html = `<div class="day-header">Найдено: ${teachersList.length}</div>`;
        for (const t of teachersList) {
            html += `
                <div class="lesson-card" style="border-left-color: #e94560;">
                    <div class="lesson-subject">${t.display}</div>
                    <div class="lesson-details">${t.position || ''}</div>
                    <button onclick="showTeacherSchedule('${t.key}')" 
                            style="margin-top: 8px; padding: 8px 12px; border-radius: 6px;
                                   border: none; background: #0f3460; color: white; cursor: pointer;">
                        Показать расписание
                    </button>
                </div>
            `;
        }
        results.innerHTML = html;
        window._lastTeachers = teachersList;
    } catch (e) {
        results.innerHTML = `<div class="empty-day">❌ Ошибка: ${e.message}</div>`;
    }
}

// ==========================================================
// РАСПИСАНИЕ ПРЕПОДАВАТЕЛЯ С ОБЪЕДИНЕНИЕМ ГРУПП
// ==========================================================
window.showTeacherSchedule = function(key) {
    const t = (window._lastTeachers || []).find(x => x.key === key);
    if (!t) return;
    const content = document.getElementById('scheduleContent');

    // 🔑 Объединяем группы: ключ = (wday, para, subject, type, room, comment)
    const merged = {};
    for (const l of (t.lessons || [])) {
        const k = `${l.wday}_${l.para}_${l.subject}_${l.type}_${l.room}_${l.comment}`;
        if (!merged[k]) {
            merged[k] = { ...l, groups: [l.group] };
        } else {
            if (!merged[k].groups.includes(l.group)) {
                merged[k].groups.push(l.group);
            }
        }
    }

    // Группируем по дням
    const byDay = {1: [], 2: [], 3: [], 4: [], 5: [], 6: []};
    for (const m of Object.values(merged)) {
        if (byDay[m.wday]) byDay[m.wday].push(m);
    }
    for (const d of Object.keys(byDay)) {
        byDay[d].sort((a, b) => (a.para || 0) - (b.para || 0));
    }

    let html = `
        <button onclick="showTeacherSearch()" 
                style="margin-bottom: 12px; padding: 8px 12px; border-radius: 6px;
                       border: none; background: #16213e; color: #eaeaea; cursor: pointer;">
            ← Назад к поиску
        </button>
        <div class="day-header">👨‍🏫 ${t.display}</div>
        <div class="lesson-details" style="margin-bottom: 16px;">${t.position || ''}</div>
    `;

    let hasLessons = false;
    for (const wday of [1, 2, 3, 4, 5, 6]) {
        const lessons = byDay[wday];
        if (lessons.length === 0) continue;
        hasLessons = true;
        html += `<div class="day-header" style="font-size: 16px; margin-top: 16px;">${WEEKDAYS_FULL[wday]}</div>`;
        for (const l of lessons) {
            const cancelClass = l.isCancelled ? ' cancelled' : '';
            const groupsStr = l.groups.join(' / ');
            const room = l.room ? `<span>🚪 ауд. ${l.room}</span>` : '';
            html += `
                <div class="lesson-card${cancelClass}">
                    <div class="lesson-time">🕐 ${l.time} (${l.para} пара) — ${l.type}</div>
                    <div class="lesson-subject">${l.subject}</div>
                    <div class="lesson-details">
                        <span>👥 ${groupsStr}</span>
                        ${room}
                    </div>
                    ${l.comment && !l.isCancelled ? `<div class="lesson-comment">💬 ${l.comment}</div>` : ''}
                    ${l.isCancelled ? '<div class="lesson-comment">❌ ОТМЕНА</div>' : ''}
                </div>
            `;
        }
    }
    if (!hasLessons) html += '<div class="empty-day">🎉 Пар нет!</div>';
    content.innerHTML = html;
};

// ==========================================================
// СТАРТ
// ==========================================================
loadSchedule();
