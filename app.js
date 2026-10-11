// Конфигурация
const API_URL = 'https://api.nntu.ru/getschedule';
const GROUP_ID = '846'; // ID группы АСИ 24-1 (нужно уточнить в API)
const DEPARTMENT_ID = 1;

let currentTab = 'today';
let currentSchedule = null;

// Дни недели
const WEEKDAYS = {1: 'Понедельник', 2: 'Вторник', 3: 'Среда', 4: 'Четверг', 5: 'Пятница', 6: 'Суббота', 7: 'Воскресенье'};

// Загрузка расписания с API
async function loadSchedule() {
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body: `&department_id=${DEPARTMENT_ID}&group_id=${GROUP_ID}&type=1&date_from=null&date_to=null`
        });
        
        if (!response.ok) throw new Error('Ошибка API');
        
        const raw = await response.json();
        currentSchedule = normalizeSchedule(raw);
        
        // Сохраняем в localStorage для офлайн-режима
        localStorage.setItem('schedule_cache', JSON.stringify({
            data: currentSchedule,
            timestamp: Date.now()
        }));
        
        render();
    } catch (error) {
        console.error('Ошибка загрузки:', error);
        
        // Пробуем взять из кэша
        const cached = localStorage.getItem('schedule_cache');
        if (cached) {
            currentSchedule = JSON.parse(cached).data;
            render();
            showNotification('Показано сохранённое расписание (нет сети)');
        } else {
            document.getElementById('scheduleContent').innerHTML = 
                '<div class="empty-day">❌ Не удалось загрузить расписание. Проверьте интернет.</div>';
        }
    }
}

// Преобразование ответа API
function normalizeSchedule(raw) {
    const result = {};
    
    for (const [wday, streams] of Object.entries(raw)) {
        const lessons = [];
        if (Array.isArray(streams)) {
            for (const stream of streams) {
                if (!Array.isArray(stream)) continue;
                for (const p of stream) {
                    const surname = p.prepod_surname || '';
                    const name = p.prepod_name || '';
                    const initials = p.prepod_initials || '';
                    
                    lessons.push({
                        number: parseInt(p.para) || 0,
                        time: p.para_time || '',
                        subject: p.predmet_name || '',
                        type: p.para_type || '',
                        teacher: surname + (name ? ' ' + name[0] + '.' : '') + (initials ? initials[0] + '.' : ''),
                        room: p.aud || '',
                        comment: p.comment || '',
                        trueTime: p.true_time || 0,
                        isCancelled: (p.comment || '').toLowerCase().includes('не будет')
                    });
                }
            }
        }
        lessons.sort((a, b) => a.number - b.number);
        result[wday] = lessons;
    }
    
    return result;
}

// Рендер
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
        // Неделя
        let html = '';
        for (let wday = 1; wday <= 6; wday++) {
            const lessons = currentSchedule[wday] || [];
            if (lessons.length > 0) {
                html += renderDay(lessons, WEEKDAYS[wday], true);
            }
        }
        content.innerHTML = html || '<div class="empty-day">🎉 На неделе пар нет!</div>';
    }
}

function renderDay(lessons, header, compact = false) {
    if (!lessons || lessons.length === 0) {
        return `<div class="empty-day">🎉 Пар нет!</div>`;
    }
    
    let html = `<div class="day-header">${header}</div>`;
    
    for (const l of lessons) {
        const cancelClass = l.isCancelled ? ' cancelled' : '';
        html += `
            <div class="lesson-card${cancelClass}">
                <div class="lesson-time">🕐 ${l.time} (${l.number} пара) — ${l.type}</div>
                <div class="lesson-subject">${l.subject}</div>
                <div class="lesson-details">
                    <span>👤 ${l.teacher}</span>
                    <span>🚪 ауд. ${l.room}</span>
                </div>
                ${l.comment && !l.isCancelled ? `<div class="lesson-comment">💬 ${l.comment}</div>` : ''}
                ${l.isCancelled ? '<div class="lesson-comment">❌ ОТМЕНА</div>' : ''}
            </div>
        `;
    }
    
    return html;
}

// Переключение вкладок
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentTab = tab.dataset.day;
        render();
    });
});

// Обновление
document.getElementById('refreshBtn').addEventListener('click', loadSchedule);

// Уведомление
function showNotification(text) {
    // Можно расширить для push-уведомлений
    console.log(text);
}

// Запуск
loadSchedule();