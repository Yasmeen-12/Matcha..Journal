document.addEventListener('DOMContentLoaded', async () => {
    const appContainer = document.getElementById('app-container');
    const mascotImageURL = '/static/assets/matcha-mascot.png'; // Using root-relative path

    // --- DATABASE SETUP (DEXIE.JS) ---
    const db = new Dexie('MatchaJournalDB');
    db.version(5).stores({
        tasks: '++id, completed',
        messages: '++id, type, timestamp',
        settings: 'key',
        sessions: '++id, timestamp, *emotions',
        dailyMetrics: '&date',
        pomodoroHistory: '++id, timestamp',
    });


    // --- STATE MANAGEMENT ---
    let state = {
        currentPage: 'landing',
        tasks: [],
        messages: [],
        pomodoro: {
            focusMinutes: 25,
            breakMinutes: 5,
            totalSessions: 3,
            currentSession: 1,
            time: 25 * 60,
            isRunning: false,
            phase: 'work',
        },
        landingPage: {
            currentQuoteIndex: 0,
            quotes: [
                { text: "The unexamined life is not worth living.", author: "Socrates", icon: 'psychology' },
                { text: "Knowing yourself is the beginning of all wisdom.", author: "Aristotle", icon: 'favorite' },
                { text: "What we plant in contemplation, we shall reap in action.", author: "Meister Eckhart", icon: 'auto_awesome' },
            ]
        },
        summaryData: {
            moodLevels: { current: 0, weekAverage: 0, monthAverage: 0, recentMoods: [] },
            lifeAspects: [{ category: "Work", percentage: 35, icon: 'work' }, { category: "Home", percentage: 28, icon: 'home' }, { category: "Health", percentage: 20, icon: 'favorite' }, { category: "Personal Growth", percentage: 17, icon: 'psychology' }],
            hydration: { today: 0, goal: 8 },
            journalStreak: { current: 0, best: 28 },
            weeklyStats: { entries: 0, words: 0, mostActive: 'N/A', pomodoroSessions: 0, tasksCompleted: 0 }
        }
    };

    // --- EMOTION SCORING SYSTEM ---
    const emotionScores = {
        'happy': 10, 'excited': 10, 'proud': 10, 'content': 9, 'grateful': 9, 'relaxed': 8, 'optimistic': 9, 'motivated': 8, 'joyful': 10,
        'calm': 7, 'thoughtful': 6, 'neutral': 6, 'reflective': 6,
        'anxious': 4, 'stressed': 4, 'overwhelmed': 3, 'worried': 5, 'nervous': 5, 'uneasy': 4,
        'sad': 3, 'angry': 1, 'frustrated': 2, 'lonely': 2, 'guilty': 2, 'disappointed': 3, 'insecure': 3, 'depressed': 2, 'down': 2, 'annoyed': 2, 'miserable': 1,
        'tired': 4, 'exhausted': 4
    };

    const calculateAverageMoodScore = (emotions) => {
        if (!emotions || emotions.length === 0) {
            return 6;
        }
        const totalScore = emotions.reduce((acc, emotion) => {
            return acc + (emotionScores[emotion.toLowerCase()] || 5);
        }, 0);
        return (totalScore / emotions.length);
    };

    // --- SUMMARY DATA CALCULATION MODULE ---
    const calculateSummaryData = async () => {
        const getRelativeDate = (date) => {
            if (!date) return 'Invalid Date';
            const today = new Date();
            const sessionDate = new Date(date);
            today.setHours(0, 0, 0, 0);
            sessionDate.setHours(0, 0, 0, 0);
            const diffTime = today.getTime() - sessionDate.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            if (diffDays === 0) return "Today";
            if (diffDays === 1) return "Yesterday";
            if (diffDays < 7) return `${diffDays} days ago`;
            return sessionDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
        };

        const today = new Date();
        const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
        const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

        const sessions = await db.sessions.orderBy('timestamp').reverse().toArray();
        
        const sessionsWithScores = sessions.map(s => ({
            ...s,
            score: calculateAverageMoodScore(s.emotions)
        }));
        
        const weeklySessions = sessionsWithScores.filter(s => new Date(s.timestamp) >= sevenDaysAgo);
        const monthlySessions = sessionsWithScores.filter(s => new Date(s.timestamp) >= thirtyDaysAgo);
        
        const calculateAverage = (arr) => arr.length ? (arr.reduce((acc, s) => acc + s.score, 0) / arr.length).toFixed(1) : "0.0";
        
        state.summaryData.moodLevels = {
            current: sessionsWithScores.length ? sessionsWithScores[0].score.toFixed(1) : "0.0",
            weekAverage: calculateAverage(weeklySessions),
            monthAverage: calculateAverage(monthlySessions),
            recentMoods: sessionsWithScores.slice(0, 5).map(s => ({
                date: getRelativeDate(s.timestamp),
                mood: s.score
            }))
        };
        
        const todayStr = new Date().toISOString().split('T')[0];
        const dailyMetric = await db.dailyMetrics.get(todayStr);
        state.summaryData.hydration.today = dailyMetric?.waterIntake || 0;

        const allSessionTimestamps = sessions.map(s => s.timestamp);
        let currentStreak = 0;
        if (allSessionTimestamps.length > 0) {
            const uniqueDays = [...new Set(allSessionTimestamps.map(ts => new Date(ts).toISOString().split('T')[0]))];
            let lastDate = new Date();
            if (!uniqueDays.includes(lastDate.toISOString().split('T')[0])) {
                 lastDate.setDate(lastDate.getDate() - 1);
            }
            while (uniqueDays.includes(lastDate.toISOString().split('T')[0])) {
                currentStreak++;
                lastDate.setDate(lastDate.getDate() - 1);
            }
        }
        state.summaryData.journalStreak.current = currentStreak;

        const allTasks = await db.tasks.toArray();
        const weeklyPomodoros = await db.pomodoroHistory.where('timestamp').aboveOrEqual(sevenDaysAgo).count();
        const weeklyWords = weeklySessions.reduce((acc, s) => acc + (s.summary?.split(' ').length || 0), 0);
        
        const hourCounts = weeklySessions.reduce((acc, s) => {
            const hour = new Date(s.timestamp).getHours();
            let period = 'Evening';
            if (hour >= 5 && hour < 12) period = 'Morning';
            if (hour >= 12 && hour < 17) period = 'Afternoon';
            acc[period] = (acc[period] || 0) + 1;
            return acc;
        }, {});

        const mostActive = Object.keys(hourCounts).length ? Object.keys(hourCounts).reduce((a, b) => hourCounts[a] > hourCounts[b] ? a : b) : 'N/A';

        state.summaryData.weeklyStats = {
            entries: weeklySessions.length,
            words: weeklyWords,
            mostActive: mostActive,
            pomodoroSessions: weeklyPomodoros,
            tasksCompleted: allTasks.filter(t => t.completed).length,
        };
    };

    const breakMessages = ["Time to stretch!", "Hydrate yourself.", "Take deep breaths.", "Rest your eyes.", "Grab a healthy snack."];
    const pageIcons = { chat: 'chat_bubble', taskboard: 'checklist', summary: 'bar_chart', info: 'info' };

    // --- ROUTING ---
    const navigateTo = async (page) => {
        if (pomodoroInterval) {
            clearInterval(pomodoroInterval);
            pomodoroInterval = null;
            state.pomodoro.isRunning = false;
        }
        if (page === 'summary') {
            await calculateSummaryData();
        }
        state.currentPage = page;
        window.location.hash = page;
        renderApp();
    };

    window.addEventListener('hashchange', () => {
        const page = window.location.hash.substring(1) || 'landing';
        if (['landing', 'chat', 'taskboard', 'summary', 'info'].includes(page)) {
            navigateTo(page);
        } else {
            navigateTo('landing');
        }
    });
    
    // --- TEMPLATES / RENDER FUNCTIONS ---
    const Layout = (pageContent) => `
        <header class="sticky top-0 z-50 glass-effect border-b border-gray-200/50">
            <div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
                <div class="flex items-center justify-between h-16">
                    <div class="flex items-center space-x-3 cursor-pointer" data-route="landing">
                        <div class="w-10 h-10 rounded-full bg-green-700 p-1 shadow-soft">
                             <img src="${mascotImageURL}" alt="Matcha mascot" class="w-full h-full object-cover rounded-full"/>
                        </div>
                        <h1 class="text-xl font-bold text-gray-800">MatchaJournal</h1>
                    </div>
                    <nav class="flex items-center space-x-1">
                        ${Object.keys(pageIcons).map(page => `
                            <a href="#${page}" data-route="${page}" class="nav-link flex items-center space-x-2 px-4 py-2 rounded-lg transition-all duration-300 ${state.currentPage === page ? 'marble-card text-green-700 shadow-soft' : 'text-gray-500 hover:text-gray-900 hover:bg-green-500/10'}">
                                <span class="material-symbols-outlined !text-xl">${pageIcons[page]}</span>
                                <span class="capitalize text-sm font-medium">${page}</span>
                            </a>
                        `).join('')}
                    </nav>
                </div>
            </div>
        </header>
        <main class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            ${pageContent}
        </main>
    `;

    const LandingPage = () => {
        const { quotes, currentQuoteIndex } = state.landingPage;
        const currentQuote = quotes[currentQuoteIndex];
        return `
        <div class="max-w-5xl mx-auto space-y-20 py-16">
            <div class="text-center space-y-6 animate-fade-in">
                <h1 class="text-5xl lg:text-7xl font-bold text-gray-800 mb-4 tracking-tight">
                    Your <span class="gradient-primary bg-clip-text text-transparent">Mindful Buddy</span> for Daily Reflection.
                </h1>
                <p class="text-xl lg:text-2xl text-gray-600 leading-relaxed max-w-3xl mx-auto">
                    MatchaJournal makes journaling effortless. Chat with Sage, your AI companion, to track tasks, understand your mood, and build a healthy routine in minutes.
                </p>
                <div class="flex flex-col sm:flex-row gap-4 justify-center pt-8">
                    <button data-route="chat" class="text-lg px-8 py-4 rounded-lg gradient-primary hover:scale-105 transition-transform duration-300 shadow-lg text-white font-bold flex items-center justify-center gap-2">
                        <span class="material-symbols-outlined">chat_bubble</span>
                        Start Your Journey
                    </button>
                    <button data-route="info" class="text-lg px-8 py-4 rounded-lg glass-effect border-green-800/30 hover:bg-green-700/10 transition-colors duration-300 font-semibold">
                        Learn More
                    </button>
                </div>
            </div>
            <div class="flex flex-col md:flex-row items-center gap-12">
                <div class="w-48 h-48 md:w-64 md:h-64 flex-shrink-0">
                    <div class="w-full h-full mx-auto gradient-primary rounded-full p-2 shadow-2xl animate-float">
                        <img src="${mascotImageURL}" alt="Sage - Your journaling companion" class="w-full h-full object-cover rounded-full"/>
                    </div>
                </div>
                <div class="text-center md:text-left">
                    <h3 class="text-3xl font-bold text-gray-800 mb-4">Meet Sage, Your Personal Guide</h3>
                    <p class="text-lg text-gray-600">Sage is more than a chatbot. It's a supportive, non-judgmental buddy designed to listen, ask thoughtful questions, and help you discover patterns in your daily life. No more staring at a blank page—just start talking.</p>
                </div>
            </div>
            <div class="space-y-12">
                <div class="text-center">
                    <h2 class="text-4xl font-bold text-gray-800">Everything You Need to Balance Productivity and Well-being</h2>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div class="marble-card p-6 text-center">
                        <span class="material-symbols-outlined !text-5xl text-green-700">smart_toy</span>
                        <h3 class="text-xl font-bold my-3">Conversational Journaling</h3>
                        <p class="text-gray-600">Chat about your day naturally. Sage identifies moods, tasks, and key moments for you.</p>
                    </div>
                    <div class="marble-card p-6 text-center">
                        <span class="material-symbols-outlined !text-5xl text-green-700">checklist</span>
                        <h3 class="text-xl font-bold my-3">Integrated Task & Time Tracking</h3>
                        <p class="text-gray-600">Seamlessly add tasks from your conversation and stay focused with a built-in Pomodoro timer.</p>
                    </div>
                    <div class="marble-card p-6 text-center">
                        <span class="material-symbols-outlined !text-5xl text-green-700">insights</span>
                        <h3 class="text-xl font-bold my-3">Personalized Insights</h3>
                        <p class="text-gray-600">Review summaries and charts that connect your productivity with your emotional well-being.</p>
                    </div>
                </div>
            </div>
            <div class="marble-card p-8 border-green-800/20 max-w-3xl mx-auto">
                <div class="space-y-6">
                    <div class="flex items-center justify-center gap-4 mb-6">
                        ${state.landingPage.quotes.map((quote, index) => `
                            <span class="quote-icon cursor-pointer text-3xl transition-all duration-300 ${index === currentQuoteIndex ? 'transform scale-125' : 'opacity-50 hover:opacity-100'}" data-quote-index="${index}">
                                <span class="material-symbols-outlined !text-4xl">${quote.icon}</span>
                            </span>
                        `).join('')}
                    </div>
                    <blockquote class="text-xl lg:text-2xl italic text-gray-700 leading-relaxed text-center h-24">"${currentQuote.text}"</blockquote>
                    <cite class="text-lg text-green-700 font-medium text-center block">— ${currentQuote.author}</cite>
                </div>
            </div>
        </div>
    `;
    };

    const ChatPage = () => `
        <div class="max-w-4xl mx-auto">
            <h1 class="text-3xl font-bold text-gray-800 mb-2">Chat with Your Journal</h1>
            <p class="text-gray-500 mb-6">Have a conversation with your AI journaling companion.</p>
            <div class="marble-card h-[600px] flex flex-col">
                <div id="message-area" class="flex-1 p-4 space-y-4 overflow-y-auto"></div>
                <div class="border-t border-gray-200/50 p-4">
                    <div class="flex space-x-2">
                        <input id="chat-input" type="text" placeholder="Share your thoughts..." class="flex-1 h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-700">
                        <button id="send-button" class="px-4 py-2 rounded-md gradient-primary text-white font-semibold">Send</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    const TaskboardPage = () => {
        const { pomodoro } = state;
        const formatTime = (seconds) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
        return `
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div class="space-y-6">
                <div class="marble-card p-6">
                    <h2 class="text-xl font-semibold text-gray-800 mb-4">Today's Tasks</h2>
                    <div class="mb-6">
                        <div class="flex justify-between text-sm text-gray-500 mb-2">
                            <span>Progress</span>
                            <span id="task-completion-text"></span>
                        </div>
                        <progress id="task-progress" value="0" max="100"></progress>
                    </div>
                    <div id="task-list" class="space-y-2 mb-4"></div>
                    <div class="flex space-x-2">
                        <input id="new-task-input" placeholder="Add a new task..." class="flex-1 h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-700">
                        <button id="add-task-button" class="px-4 py-2 rounded-md gradient-primary text-white font-semibold">+</button>
                    </div>
                </div>
            </div>
            <div class="space-y-6">
                <div class="marble-card p-6 text-center">
                    <h2 class="text-xl font-semibold text-gray-800 mb-4">Pomodoro Timer</h2>
                    <div class="grid grid-cols-3 gap-4 mb-6">
                        <div>
                            <label for="pomodoro-sessions" class="block text-sm font-medium text-gray-600 mb-1">Sessions</label>
                            <select id="pomodoro-sessions" class="w-full h-10 rounded-md border-gray-300 text-center">
                                ${Array.from({length: 10}, (_, i) => i + 1).map(n => `<option value="${n}" ${pomodoro.totalSessions === n ? 'selected' : ''}>${n}</option>`).join('')}
                            </select>
                        </div>
                        <div>
                            <label for="pomodoro-focus" class="block text-sm font-medium text-gray-600 mb-1">Focus</label>
                            <select id="pomodoro-focus" class="w-full h-10 rounded-md border-gray-300 text-center">
                                <option value="15" ${pomodoro.focusMinutes === 15 ? 'selected' : ''}>15 min</option>
                                <option value="25" ${pomodoro.focusMinutes === 25 ? 'selected' : ''}>25 min</option>
                                <option value="45" ${pomodoro.focusMinutes === 45 ? 'selected' : ''}>45 min</option>
                                <option value="60" ${pomodoro.focusMinutes === 60 ? 'selected' : ''}>60 min</option>
                            </select>
                        </div>
                        <div>
                            <label for="pomodoro-break" class="block text-sm font-medium text-gray-600 mb-1">Break</label>
                            <select id="pomodoro-break" class="w-full h-10 rounded-md border-gray-300 text-center">
                                <option value="5" ${pomodoro.breakMinutes === 5 ? 'selected' : ''}>5 min</option>
                                <option value="10" ${pomodoro.breakMinutes === 10 ? 'selected' : ''}>10 min</option>
                                <option value="15" ${pomodoro.breakMinutes === 15 ? 'selected' : ''}>15 min</option>
                            </select>
                        </div>
                    </div>
                    <div id="pomodoro-timer" class="text-6xl font-bold text-gray-800 my-4">${formatTime(pomodoro.time)}</div>
                    <div id="pomodoro-phase" class="text-gray-500 uppercase tracking-wider mb-2"></div>
                    <div id="pomodoro-message" class="text-green-700 h-6 mb-4"></div>
                    <div class="flex justify-center space-x-4">
                        <button id="pomodoro-start-pause" class="px-6 py-3 rounded-md gradient-primary text-white font-semibold">Start</button>
                        <button id="pomodoro-reset" class="px-6 py-3 rounded-md border border-gray-300 bg-white text-gray-700 font-semibold">Reset</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    };
    
    const InfoPage = () => `
        <div class="max-w-6xl mx-auto space-y-8">
            <div class="mb-6">
                <h1 class="text-3xl font-bold text-gray-800 mb-2">About MatchaJournal</h1>
                <p class="text-gray-500">Your mindful AI-powered journaling companion for personal growth and self-reflection.</p>
            </div>
            <div class="marble-card p-8 text-center">
                <div class="flex justify-center mb-6">
                    <div class="w-20 h-20 rounded-full gradient-primary p-2 shadow-marble"><img src="${mascotImageURL}" alt="Matcha mascot" class="w-full h-full object-cover rounded-full"/></div>
                </div>
                <h2 class="text-2xl font-bold text-gray-800 mb-4">Welcome to Your Digital Mindfulness Space</h2>
                <p class="text-gray-600 max-w-2xl mx-auto">MatchaJournal combines the tranquility of traditional journaling with the power of AI to create a personalized space for reflection, growth, and mindful productivity.</p>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div class="marble-card p-6"><div class="text-3xl mb-4"><span class="material-symbols-outlined !text-4xl">smart_toy</span></div><h3 class="text-lg font-semibold text-gray-800 mb-2">AI-Powered Conversations</h3><p class="text-sm text-gray-600">Chat naturally with your journal using advanced AI.</p></div>
                <div class="marble-card p-6"><div class="text-3xl mb-4"><span class="material-symbols-outlined !text-4xl">task_alt</span></div><h3 class="text-lg font-semibold text-gray-800 mb-2">Task Management</h3><p class="text-sm text-gray-600">Organize your daily tasks and boost productivity.</p></div>
                <div class="marble-card p-6"><div class="text-3xl mb-4"><span class="material-symbols-outlined !text-4xl">timer</span></div><h3 class="text-lg font-semibold text-gray-800 mb-2">Pomodoro Timer</h3><p class="text-sm text-gray-600">Stay focused with a built-in Pomodoro timer.</p></div>
                <div class="marble-card p-6"><div class="text-3xl mb-4"><span class="material-symbols-outlined !text-4xl">analytics</span></div><h3 class="text-lg font-semibold text-gray-800 mb-2">Analytics & Insights</h3><p class="text-sm text-gray-600">Track your mood, habits, and life balance.</p></div>
                <div class="marble-card p-6"><div class="text-3xl mb-4"><span class="material-symbols-outlined !text-4xl">lock</span></div><h3 class="text-lg font-semibold text-gray-800 mb-2">Privacy First</h3><p class="text-sm text-gray-600">Your thoughts and data are encrypted and stored securely.</p></div>
                <div class="marble-card p-6"><div class="text-3xl mb-4"><span class="material-symbols-outlined !text-4xl">self_improvement</span></div><h3 class="text-lg font-semibold text-gray-800 mb-2">Mindful Design</h3><p class="text-sm text-gray-600">Calming matcha-inspired design promotes mindfulness.</p></div>
            </div>
            <div class="marble-card p-8">
                <h2 class="text-2xl font-bold text-gray-800 mb-6">How to Get Started</h2>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div class="text-center"><div class="w-12 h-12 rounded-full gradient-primary text-white flex items-center justify-center text-lg font-bold mx-auto mb-4">1</div><h3 class="text-lg font-semibold text-gray-800 mb-2">Start Chatting</h3><p class="text-sm text-gray-600">Click on the Chat tab and start a conversation.</p></div>
                    <div class="text-center"><div class="w-12 h-12 rounded-full gradient-primary text-white flex items-center justify-center text-lg font-bold mx-auto mb-4">2</div><h3 class="text-lg font-semibold text-gray-800 mb-2">Manage Tasks</h3><p class="text-sm text-gray-600">Use the Dashboard to add daily tasks and try the Pomodoro timer.</p></div>
                    <div class="text-center"><div class="w-12 h-12 rounded-full gradient-primary text-white flex items-center justify-center text-lg font-bold mx-auto mb-4">3</div><h3 class="text-lg font-semibold text-gray-800 mb-2">Review Insights</h3><p class="text-sm text-gray-600">Check the Summary tab to see your mood trends.</p></div>
                </div>
            </div>
        </div>
    `;
    
    const SummaryPage = () => {
        const { moodLevels, lifeAspects, hydration, journalStreak, weeklyStats } = state.summaryData;
        const getMoodColor = (mood) => {
            const score = parseFloat(mood);
            if (score >= 9) return "bg-green-500";
            if (score >= 8) return "bg-lime-400";
            if (score >= 7) return "bg-yellow-400";
            if (score >= 5) return "bg-yellow-500";
            if (score >= 3) return "bg-orange-500";
            return "bg-red-500";
        };
        const hydrationPercentage = (hydration.today / hydration.goal) * 100;
        const circumference = 2 * Math.PI * 40;
        const pomodoroCircumference = 2 * Math.PI * 36;
        const tasksCircumference = 2 * Math.PI * 36;
        const pomodoroPercentage = Math.min((weeklyStats.pomodoroSessions / 20) * 100, 100);
        const tasksPercentage = Math.min((weeklyStats.tasksCompleted / 15) * 100, 100);

        return `
            <div class="max-w-7xl mx-auto">
                <div class="text-center mb-12">
                    <h1 class="text-4xl lg:text-5xl font-bold gradient-primary bg-clip-text text-transparent mb-4">Your Journey Summary</h1>
                    <p class="text-lg text-gray-500 max-w-2xl mx-auto">Beautiful insights into your daily patterns, mood trends, and life balance</p>
                </div>
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div class="lg:col-span-1 space-y-6">
                        <div class="marble-card p-8">
                            <h3 class="text-2xl font-bold text-gray-800 mb-6">Mood Journey</h3>
                            <div class="grid grid-cols-2 gap-4 mb-6">
                                <div class="text-center p-4 glass-effect rounded-lg">
                                    <div class="text-2xl font-bold text-gray-800">${moodLevels.weekAverage}</div>
                                    <div class="text-sm text-gray-600">Week Average</div>
                                </div>
                                <div class="text-center p-4 glass-effect rounded-lg">
                                    <div class="text-2xl font-bold text-gray-800">${moodLevels.monthAverage}</div>
                                    <div class="text-sm text-gray-600">Month Average</div>
                                </div>
                            </div>
                            <div class="space-y-3">
                                ${moodLevels.recentMoods.slice(0, 3).map(mood => `
                                    <div class="flex items-center justify-between">
                                        <span class="text-sm text-gray-600 w-24">${mood.date}</span>
                                        <div class="flex items-center gap-2 flex-1">
                                            <div class="w-full bg-gray-200 rounded-full h-2.5"><div class="${getMoodColor(mood.mood)} h-2.5 rounded-full" style="width: ${mood.mood * 10}%"></div></div>
                                            <span class="font-semibold text-gray-800 w-8 text-right">${parseFloat(mood.mood).toFixed(1)}</span>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                        <div class="marble-card p-6 text-center">
                            <h3 class="text-lg font-semibold text-gray-800 mb-4 flex items-center justify-center"><span class="material-symbols-outlined mr-2">trending_up</span>Weekly Stats</h3>
                            <div class="flex justify-around">
                                <div><div class="text-2xl font-bold text-green-700">${weeklyStats.entries}</div><div class="text-xs text-gray-500">Entries</div></div>
                                <div><div class="text-2xl font-bold text-green-700">${weeklyStats.words.toLocaleString()}</div><div class="text-xs text-gray-500">Words</div></div>
                                <div><div class="text-sm font-medium text-green-800">${weeklyStats.mostActive}</div><div class="text-xs text-gray-500">Most Active</div></div>
                            </div>
                             <hr class="my-4 border-gray-200/50 -mx-6">
                            <div class="flex justify-around mt-4">
                               <div class="text-center">
                                    <div class="relative w-20 h-20 mx-auto">
                                        <svg class="w-full h-full transform -rotate-90"><circle cx="40" cy="40" r="36" stroke="currentColor" stroke-width="4" fill="transparent" class="text-gray-200"/><circle cx="40" cy="40" r="36" stroke="currentColor" stroke-width="4" fill="transparent" stroke-dasharray="${pomodoroCircumference}" stroke-dashoffset="${pomodoroCircumference - (pomodoroPercentage / 100) * pomodoroCircumference}" class="text-orange-500" stroke-linecap="round"/></svg>
                                        <div class="absolute inset-0 flex items-center justify-center"><span class="text-xl font-bold text-gray-800">${weeklyStats.pomodoroSessions}</span></div>
                                    </div>
                                    <div class="text-xs text-gray-500 mt-2">Pomodoros</div>
                                </div>
                               <div class="text-center">
                                    <div class="relative w-20 h-20 mx-auto">
                                        <svg class="w-full h-full transform -rotate-90"><circle cx="40" cy="40" r="36" stroke="currentColor" stroke-width="4" fill="transparent" class="text-gray-200"/><circle cx="40" cy="40" r="36" stroke="currentColor" stroke-width="4" fill="transparent" stroke-dasharray="${tasksCircumference}" stroke-dashoffset="${tasksCircumference - (tasksPercentage / 100) * tasksCircumference}" class="text-purple-500" stroke-linecap="round"/></svg>
                                        <div class="absolute inset-0 flex items-center justify-center"><span class="text-xl font-bold text-gray-800">${weeklyStats.tasksCompleted}</span></div>
                                    </div>
                                    <div class="text-xs text-gray-500 mt-2">Tasks Done</div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="lg:col-span-1 space-y-6">
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            <div class="marble-card p-6 text-center flex flex-col justify-between">
                                <div>
                                    <h3 class="text-lg font-semibold text-gray-800 mb-4 flex items-center justify-center"><span class="material-symbols-outlined mr-2">water_drop</span> Hydration</h3>
                                    <div class="relative w-24 h-24 mx-auto mb-4">
                                        <svg class="w-full h-full transform -rotate-90"><circle cx="48" cy="48" r="40" stroke="currentColor" stroke-width="8" fill="transparent" class="text-gray-200"/><circle cx="48" cy="48" r="40" stroke="currentColor" stroke-width="8" fill="transparent" stroke-dasharray="${circumference}" stroke-dashoffset="${circumference - (hydrationPercentage / 100) * circumference}" class="text-blue-500" stroke-linecap="round"/></svg>
                                        <div class="absolute inset-0 flex items-center justify-center"><span class="text-xl font-bold text-gray-800">${hydration.today}</span></div>
                                    </div>
                                </div>
                                <div class="text-sm text-gray-500">/ ${hydration.goal} glasses</div>
                            </div>
                            <div class="marble-card p-6 text-center flex flex-col justify-between">
                                <div>
                                    <h3 class="text-lg font-semibold text-gray-800 mb-2 flex items-center justify-center"><span class="material-symbols-outlined mr-2">local_fire_department</span> Journal Streak</h3>
                                    <div class="text-3xl font-bold text-green-700 my-4">${journalStreak.current}</div>
                                    <div class="text-sm text-gray-500">days</div>
                                </div>
                                <div class="text-xs text-gray-500 mt-2">Best: ${journalStreak.best} days</div>
                            </div>
                        </div>
                        <div class="marble-card p-6">
                            <h3 class="text-xl font-semibold text-gray-800 mb-6">Life Balance</h3>
                            <div class="grid grid-cols-2 gap-4">
                                ${lifeAspects.map(aspect => `
                                    <div class="p-4 glass-effect rounded-xl">
                                        <div class="flex items-center justify-between mb-3">
                                            <span class="material-symbols-outlined !text-2xl">${aspect.icon}</span>
                                            <span class="text-xs font-bold py-1 px-2 rounded-full gradient-primary text-white">${aspect.percentage}%</span>
                                        </div>
                                        <div class="text-sm font-medium text-gray-800 mb-2">${aspect.category}</div>
                                        <progress value="${aspect.percentage}" max="100"></progress>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    };

    // --- GRANULAR RENDER FUNCTIONS ---
    const renderMessages = () => {
        const messageArea = document.getElementById('message-area');
        if (!messageArea) return;
        messageArea.innerHTML = state.messages.map(msg => `
            <div class="chat-message flex items-start space-x-3 ${msg.type === 'user' ? 'flex-row-reverse space-x-reverse' : ''}">
                <div class="flex-shrink-0 w-8 h-8 rounded-full ${msg.type === 'ai' ? 'bg-green-700 p-1' : 'bg-gray-300 flex items-center justify-center font-bold text-gray-600'}">
                    ${msg.type === 'ai' ? `<img src="${mascotImageURL}" class="w-full h-full object-cover rounded-full"/>` : 'U'}
                </div>
                <div class="flex-1 max-w-xs sm:max-w-md ${msg.type === 'user' ? 'text-right' : ''}">
                    <div class="p-3 rounded-lg ${msg.type === 'user' ? 'gradient-primary text-white' : 'bg-gray-200 text-gray-700'}">
                        <p class="text-sm">${msg.content}</p>
                    </div>
                </div>
            </div>
        `).join('');
        messageArea.scrollTop = messageArea.scrollHeight;
    };

    const renderTasks = () => {
        const taskList = document.getElementById('task-list');
        if (!taskList) return;
        taskList.innerHTML = state.tasks.map(task => `
            <div class="flex items-center space-x-3 p-3 rounded-lg hover:bg-green-500/10 ${task.completed ? 'opacity-60' : ''}">
                <input type="checkbox" data-task-id="${task.id}" ${task.completed ? 'checked' : ''} class="task-checkbox h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500">
                <span class="${task.completed ? 'line-through text-gray-500' : 'text-gray-800'}">${task.title}</span>
            </div>
        `).join('');
        document.querySelectorAll('.task-checkbox').forEach(box => {
            box.addEventListener('change', async (e) => {
                const taskId = parseInt(e.target.getAttribute('data-task-id'));
                const task = state.tasks.find(t => t.id === taskId);
                if (task) {
                    task.completed = e.target.checked;
                    await db.tasks.update(taskId, { completed: e.target.checked });
                    renderTasks();
                }
            });
        });
        const completedTasks = state.tasks.filter(t => t.completed).length;
        const totalTasks = state.tasks.length;
        const progress = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;
        const progressEl = document.getElementById('task-progress');
        const completionTextEl = document.getElementById('task-completion-text');
        if (progressEl) progressEl.value = progress;
        if (completionTextEl) completionTextEl.innerText = `${completedTasks}/${totalTasks} completed`;
    };
    
    const updatePomodoroUI = () => {
        const timerEl = document.getElementById('pomodoro-timer');
        const phaseEl = document.getElementById('pomodoro-phase');
        const messageEl = document.getElementById('pomodoro-message');
        const startPauseButton = document.getElementById('pomodoro-start-pause');
        if (!timerEl || !phaseEl || !messageEl || !startPauseButton) return;
        const time = state.pomodoro.time;
        timerEl.innerText = `${Math.floor(time / 60).toString().padStart(2, '0')}:${(time % 60).toString().padStart(2, '0')}`;
        if (state.pomodoro.phase === 'work') {
            phaseEl.innerText = `Session ${state.pomodoro.currentSession} of ${state.pomodoro.totalSessions}`;
            messageEl.innerText = '';
        } else {
            phaseEl.innerText = 'Break Time';
            if (messageEl.innerText === '') {
                 messageEl.innerText = breakMessages[Math.floor(Math.random() * breakMessages.length)];
            }
        }
        startPauseButton.textContent = state.pomodoro.isRunning ? 'Pause' : 'Start';
    };
    
    // --- MAIN RENDER FUNCTION ---
    const renderApp = () => {
        let content = '';
        if (state.currentPage === 'landing') {
            content = LandingPage();
        } else {
            let pageContent = '';
            if (state.currentPage === 'chat') pageContent = ChatPage();
            else if (state.currentPage === 'taskboard') pageContent = TaskboardPage();
            else if (state.currentPage === 'summary') pageContent = SummaryPage();
            else if (state.currentPage === 'info') pageContent = InfoPage();
            content = Layout(pageContent);
        }
        appContainer.innerHTML = content;
        addEventListeners();
        if (state.currentPage === 'chat') renderMessages();
        if (state.currentPage === 'taskboard') {
            renderTasks();
            updatePomodoroUI();
        }
    };

    // --- EVENT LISTENERS ---
    let pomodoroInterval = null;
    const addEventListeners = () => {
        document.querySelectorAll('[data-route]').forEach(el => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                navigateTo(el.getAttribute('data-route'));
            });
        });
        
        if (state.currentPage === 'landing') {
            document.querySelectorAll('.quote-icon').forEach(icon => {
                icon.addEventListener('click', (e) => {
                    const index = parseInt(e.currentTarget.getAttribute('data-quote-index'));
                    state.landingPage.currentQuoteIndex = index;
                    renderApp();
                });
            });
        }

        if (state.currentPage === 'chat') {
            const sendButton = document.getElementById('send-button');
            const chatInput = document.getElementById('chat-input');
            const handleSend = async () => {
                const content = chatInput.value;
                if (!content.trim()) return;

                const userMessage = { type: 'user', content, timestamp: new Date() };
                await db.messages.add(userMessage);
                state.messages.push(userMessage);
                chatInput.value = '';
                renderMessages();

                const thinkingMessage = { type: 'ai', content: 'Thinking...', timestamp: new Date() };
                state.messages.push(thinkingMessage);
                renderMessages();

                try {
                    const res = await fetch('/api/chat', { 
                        method: 'POST', 
                        headers: { 'Content-Type': 'application/json'},
                        body: JSON.stringify({
                            message: content,
                            history: state.messages.slice(0, -2) // Send history without user's latest and "Thinking..."
                        })
                    });
                    
                    if (!res.ok) {
                        const errorText = await res.text();
                        throw new Error(`Server responded with status ${res.status}: ${errorText}`);
                    }

                    const aiData = await res.json();
                    
                    if (aiData.newTasks && Array.isArray(aiData.newTasks) && aiData.newTasks.length > 0) {
                        const tasksToAdd = aiData.newTasks.map(title => ({ title, completed: false }));
                        await db.tasks.bulkAdd(tasksToAdd);
                        state.tasks = await db.tasks.toArray();
                    }
                    
                    let emotionsToSave = [];
                    if (aiData.emotions && Array.isArray(aiData.emotions)) {
                        emotionsToSave = aiData.emotions;
                    }

                    if (emotionsToSave.length > 0) {
                        await db.sessions.add({
                            emotions: emotionsToSave,
                            summary: aiData.summary || "No summary provided.",
                            timestamp: new Date()
                        });
                    }

                    if (typeof aiData.waterIntake === 'number' && aiData.waterIntake > 0) {
                        const today = new Date().toISOString().split('T')[0];
                        await db.dailyMetrics.put({
                            date: today,
                            waterIntake: aiData.waterIntake
                        });
                    }

                    const aiReply = { type: 'ai', content: aiData.reply, timestamp: new Date() };
                    await db.messages.add(aiReply);
                    state.messages.pop(); // Remove "Thinking..." message
                    state.messages.push(aiReply);
                    renderMessages();
                    
                } catch (err) {
                    console.error("Error in handleSend:", err);
                    state.messages.pop(); // Remove "Thinking..." message
                    const errorMessage = { type: 'ai', content: `A critical error occurred: ${err.message}. Please check the console (F12) for more details.`, timestamp: new Date() };
                    state.messages.push(errorMessage);
                    renderMessages();
                }
            };
            sendButton.addEventListener('click', handleSend);
            chatInput.addEventListener('keypress', (e) => e.key === 'Enter' && handleSend());
            chatInput.focus();
        }

        if (state.currentPage === 'taskboard') {
            document.getElementById('add-task-button').addEventListener('click', async () => {
                const input = document.getElementById('new-task-input');
                if (input.value.trim()) {
                    const newTask = { title: input.value, completed: false };
                    const newId = await db.tasks.add(newTask);
                    state.tasks.push({ ...newTask, id: newId });
                    input.value = '';
                    renderTasks();
                }
            });

            const stopPomodoro = () => {
                clearInterval(pomodoroInterval);
                pomodoroInterval = null;
                state.pomodoro.isRunning = false;
                updatePomodoroUI();
            };

            const resetPomodoro = () => {
                stopPomodoro();
                state.pomodoro.currentSession = 1;
                state.pomodoro.phase = 'work';
                state.pomodoro.time = state.pomodoro.focusMinutes * 60;
                updatePomodoroUI();
            };

            const tick = async () => {
                state.pomodoro.time--;
                if (state.pomodoro.time < 0) {
                     if (state.pomodoro.phase === 'work') {
                        await db.pomodoroHistory.add({ timestamp: new Date() });
                        if (state.pomodoro.currentSession < state.pomodoro.totalSessions) {
                            state.pomodoro.phase = 'break';
                            state.pomodoro.time = state.pomodoro.breakMinutes * 60;
                        } else {
                            alert("All done, good job! I hope the sessions were productive.");
                            resetPomodoro();
                            return; 
                        }
                    } else { 
                        state.pomodoro.currentSession++;
                        state.pomodoro.phase = 'work';
                        state.pomodoro.time = state.pomodoro.focusMinutes * 60;
                    }
                }
                updatePomodoroUI();
            };

            document.getElementById('pomodoro-start-pause').addEventListener('click', () => {
                state.pomodoro.isRunning = !state.pomodoro.isRunning;
                if (state.pomodoro.isRunning) {
                    pomodoroInterval = setInterval(tick, 1000);
                } else {
                    clearInterval(pomodoroInterval);
                    pomodoroInterval = null;
                }
                updatePomodoroUI();
            });

            document.getElementById('pomodoro-reset').addEventListener('click', resetPomodoro);
            
            const pomodoroSettingsChanged = async () => {
                if(state.pomodoro.isRunning) return;
                state.pomodoro.totalSessions = parseInt(document.getElementById('pomodoro-sessions').value);
                state.pomodoro.focusMinutes = parseInt(document.getElementById('pomodoro-focus').value);
                state.pomodoro.breakMinutes = parseInt(document.getElementById('pomodoro-break').value);
                await db.settings.put({
                    key: 'pomodoro',
                    sessions: state.pomodoro.totalSessions,
                    focus: state.pomodoro.focusMinutes,
                    break: state.pomodoro.breakMinutes,
                });
                if (state.pomodoro.phase === 'work' || !state.pomodoro.isRunning) {
                    resetPomodoro();
                }
            };

            document.getElementById('pomodoro-sessions').addEventListener('change', pomodoroSettingsChanged);
            document.getElementById('pomodoro-focus').addEventListener('change', pomodoroSettingsChanged);
            document.getElementById('pomodoro-break').addEventListener('change', pomodoroSettingsChanged);
        }
    };
    
    // --- INITIAL DATA LOAD ---
    const loadInitialData = async () => {
        const tasksFromDB = await db.tasks.toArray();
        if (tasksFromDB.length > 0) {
            state.tasks = tasksFromDB;
        } else {
            const defaultTasks = [
                { title: "Complete morning meditation", completed: true },
                { title: "Write in journal for 15 minutes", completed: false },
                { title: "Read 20 pages of current book", completed: false },
            ];
            await db.tasks.bulkAdd(defaultTasks);
            state.tasks = await db.tasks.toArray();
        }

        const messagesFromDB = await db.messages.toArray();
        if (messagesFromDB.length > 0) {
            state.messages = messagesFromDB;
        } else {
            const welcomeMessage = { type: "ai", content: "Hello! I'm Sage, your personal journaling companion. How are you feeling today?", timestamp: new Date() };
            await db.messages.add(welcomeMessage);
            state.messages = await db.messages.toArray();
        }

        const pomodoroSettings = await db.settings.get('pomodoro');
        if (pomodoroSettings) {
            state.pomodoro.totalSessions = pomodoroSettings.sessions;
            state.pomodoro.focusMinutes = pomodoroSettings.focus;
            state.pomodoro.breakMinutes = pomodoroSettings.break;
        }
        state.pomodoro.time = state.pomodoro.focusMinutes * 60;

        await calculateSummaryData(); 
        
        const initialPage = window.location.hash.substring(1) || 'landing';
        await navigateTo(initialPage);
    };

    await loadInitialData();
});