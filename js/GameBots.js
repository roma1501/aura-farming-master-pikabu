// GameBots.js — боты-«люди» (DESIGN.md §0.3, §5): онлайна нет, все соперники — боты, которые
// ведут себя как живые игроки. Имена в духе Roblox (латиница и русские/транслит ~50/50, без
// повторов за сессию), разная внешность (архетипы: новичок, «бекон», девочка с длинными волосами,
// ниндзя, робот, красная толстовка, пастель, богач в короне …; совместимость аксессуаров —
// BOT_ACC, без color для crown/horns/sunglasses/sword_back; внешность собирается из
// каталога гардероба — GameWardrobe.botLook по архетипу и ауре), реалистичная аура (много 0–80, часть
// 100–700, редкие 1000–3000; растёт от их шлепков), перчатки — GameGloves.pickForBot, личности,
// человечное управление, чат-пузыри (GameUI.bubble) и вход/выход (GameUI.notice).
//
// Личности (kind): hunter — агрессивный, ищет слабых и стоящих у края, заходит со стороны
// центра, чтобы выбить за край; avenger — гонится за обидчиком; careful — держится центра;
// newbie — бродит, прыгает, иногда сам падает с края; afk — стоит 10–40 с, потом
// «возвращается»; showoff — после KO танцует/машет и пишет «ez»; friend — пара друзей (общая
// команда char.team: не бьют друг друга, ходят рядом, заступаются); fan — тянется к игроку.
// На игрока одновременно нацелено не больше BOT_MAX_ON_PLAYER ботов (весело, но честно).
//
// ИИ: решения (_think) — раз в 0.3–1 с у каждого бота со своей фазой (не больше
// BOT_THINKS_PER_FRAME за кадр), рулевое движение (_steer) — каждый кадр: сглаживание, шум,
// реакция 0.15–0.5 с на новую цель и после подъёма, стрейф/кружение, заход со стороны центра,
// выжидание перезарядки цели (сильные), рывок (сближение, уход от края, уклон от замаха бота),
// прыжки, обход препятствий (GameWorld.colliders), избегание края (edgeDist; новичок иногда
// «зевает»), выход из «застревания». Шлепок — GameCombat.trySlap(bot, target, { miss }),
// вероятность промаха — от skill; боты шлёпают и друг друга.
//
// Лобби: гуляют по маркерам lobby-walk, стоят у пьедесталов и «примеряют» перчатки, смотрят
// доску рекордов, машут игроку; через 25–90 с идут в портал (на арену — если игрок там и ботов
// не хватает, иначе «ушли в другой режим»); на их место входят новые.
// Арена: после падения — снова через 3–8 с (иногда «выходит», вместо него входит новый).
//
// API (договорённость с GameModes): populate(zone, count, opts?) — держать count ботов
// (opts: { hardcore, skill }); spawnBot(zone, opts?) -> Character (opts: { x, y, heading,
// skill 0..1, aura, glove, respawn (по умолчанию true), personality, name }); remove(bot);
// clear(zone); freeze(zone, on); isFrozen(zone); list(zone) -> Character[]; spawn(n) — для
// Game.debug.spawnBots; report() — счётчики (Game.debug.bots()).
// Бот: char.isBot = true, состояние ИИ — char.data.bot (BotState).

// --- Числа модуля (позже — в Constants.js) ---
const BOT_REACTION_MIN = 0.15;      // с: задержка реакции на новую цель / после подъёма
const BOT_REACTION_MAX = 0.5;
const BOT_THINK_MIN = 0.3;          // с между решениями бота
const BOT_THINK_MAX = 1.0;
const BOT_THINKS_PER_FRAME = 4;     // решений за кадр (ИИ размазан по кадрам)
const BOT_MAX_ON_PLAYER = 2;        // ботов, одновременно нацеленных на игрока
const BOT_SPEED_MIN = 0.88;         // × скорость бега (игрок — 1)
const BOT_SPEED_MAX = 0.98;
const BOT_SEE = 2600;               // px: дальше цели не замечают
const BOT_MISS_BASE = 0.06;         // промах: BASE + SKILL × (1 − skill)
const BOT_MISS_SKILL = 0.42;
const BOT_EDGE_MIN = 110;           // px: запас до края (+ BOT_EDGE_SKILL × skill)
const BOT_EDGE_SKILL = 220;
const BOT_LAPSE = 0.012;            // шанс новичка «зевнуть» край (на решение у края)
const BOT_RESPAWN_MIN = 3;          // с до появления после падения
const BOT_RESPAWN_MAX = 8;
const BOT_QUIT = 0.12;              // шанс после падения «выйти из игры»
const BOT_JOIN_MIN = 2.5;           // с: новый «игрок» входит на место ушедшего (арена)
const BOT_JOIN_MAX = 7;
const BOT_LOBBY_JOIN_MIN = 4;       // то же в лобби
const BOT_LOBBY_JOIN_MAX = 12;
const BOT_LOBBY_STAY_MIN = 25;      // с в лобби до похода в портал
const BOT_LOBBY_STAY_MAX = 90;
const BOT_SESSION_MIN = 150;        // с на арене до «выхода из игры»
const BOT_SESSION_MAX = 700;
const BOT_AFK_MIN = 10;             // с «отошёл от компьютера»
const BOT_AFK_MAX = 40;
const BOT_GRUDGE = 12;              // с помнит обидчика
const BOT_STUCK = 1.2;              // с почти без движения при желании идти — «застрял»
const BOT_CHAT_GAP_MIN = 1.6;       // с между пузырями любых ботов
const BOT_CHAT_GAP_MAX = 3.5;
const BOT_CHAT_SELF_MIN = 8;        // с между пузырями одного бота
const BOT_CHAT_SELF_MAX = 16;
const BOT_IDLE_CHAT_MIN = 9;        // с между случайными репликами
const BOT_IDLE_CHAT_MAX = 22;
const BOT_CHAT_DIST = 2200;         // px от игрока: дальше бот не пишет (не видно)
const BOT_NOTICE_CHANCE = 0.55;     // шанс строки «вошёл/вышел» в ленте
const BOT_NOTICE_GAP = 4;           // с между такими строками

Object.assign(LANG_STRINGS.ru, {
    'botJoined': '{name} присоединился',
    'botLeft': '{name} вышел',
});
Object.assign(LANG_STRINGS.en, {
    'botJoined': '{name} joined',
    'botLeft': '{name} left',
});

// Аксессуары (tools/blender/char/accessories.json, README): слот (в слоте один предмет),
// tint — можно передавать color (есть материал Tint), conflicts — не надевать вместе.
/** @type {Record<string, { slot: string, tint: boolean, conflicts: string[] }>} */
const BOT_ACC = {
    cap: { slot: 'hat', tint: true, conflicts: ['hair_spiky', 'headphones', 'horns', 'cat_ears', 'crown', 'tophat', 'beanie'] },
    tophat: { slot: 'hat', tint: true, conflicts: ['hair_spiky', 'headphones', 'horns', 'cat_ears', 'crown', 'cap', 'beanie'] },
    beanie: { slot: 'hat', tint: true, conflicts: ['hair_spiky', 'headphones', 'horns', 'cat_ears', 'crown', 'cap', 'tophat'] },
    crown: { slot: 'hat', tint: false, conflicts: ['hair_spiky', 'headphones', 'horns', 'cat_ears', 'cap', 'tophat', 'beanie'] },
    horns: { slot: 'hat', tint: false, conflicts: ['cap', 'tophat', 'beanie', 'crown', 'cat_ears'] },
    cat_ears: { slot: 'hat', tint: true, conflicts: ['cap', 'tophat', 'beanie', 'crown', 'horns', 'hair_spiky'] },
    headphones: { slot: 'ears', tint: true, conflicts: ['cap', 'tophat', 'beanie', 'crown', 'hair_spiky'] },
    hair_spiky: { slot: 'hair', tint: true, conflicts: ['cap', 'tophat', 'beanie', 'crown', 'cat_ears', 'headphones'] },
    hair_long: { slot: 'hair', tint: true, conflicts: ['backpack', 'sword_back', 'wings'] },
    hair_bob: { slot: 'hair', tint: true, conflicts: [] },
    sunglasses: { slot: 'face', tint: false, conflicts: [] },
    backpack: { slot: 'back', tint: true, conflicts: ['hair_long', 'sword_back', 'wings'] },
    sword_back: { slot: 'back', tint: false, conflicts: ['hair_long', 'backpack', 'wings'] },
    wings: { slot: 'back', tint: true, conflicts: ['hair_long', 'backpack', 'sword_back'] },
};

// Палитра в духе Roblox (BrickColor), тона кожи, цвета волос.
const BOT_C = {
    red: 0xc4281c, crimson: 0x8f1b1b, blue: 0x0d69ac, navy: 0x1f3a6e, cyan: 0x04afec, teal: 0x169c9c,
    green: 0x287f47, lime: 0xa4bd47, yellow: 0xf5cd30, orange: 0xda8541, pink: 0xff98dc, hotPink: 0xff5fb8,
    lavender: 0xb1a7ff, purple: 0x6b32a8, sky: 0x80bbdc, mint: 0x9fe3c0, white: 0xf2f3f3, grey: 0xa3a2a5,
    darkGrey: 0x5b5b5e, black: 0x1f2428, brown: 0x7c5c46, gold: 0xefb838, sand: 0xd7c59a,
};
const BOT_SKINS = [0xffcc99, 0xf2c8a2, 0xeab892, 0xcc8e69, 0xa47152, 0x7c5c46, 0x5a3c2c];
const BOT_HAIRS = [0x1b1b1b, 0x2e1d12, 0x5a3a22, 0x8a4b22, 0xe8c46a, 0xc0562a, 0xff8fc7, 0x3d7bff, 0xeeeeee, 0x7b4bd8];

// Ники: латиница, кириллица, транслит.
const BOT_NAME_EN = {
    adj: ['Brave', 'Legendary', 'Epic', 'Super', 'Mega', 'Ultra', 'Crazy', 'Happy', 'Silly', 'Shadow', 'Dark', 'Golden', 'Cool',
        'Fast', 'Tiny', 'Big', 'Lucky', 'Sneaky', 'Royal', 'Mystic', 'Cosmic', 'Frosty', 'Fire', 'Ice', 'Pixel', 'Turbo', 'Hyper',
        'Sweet', 'Fluffy', 'Lazy', 'Wild', 'Sunny', 'Moon', 'Star', 'Night', 'Noble', 'Swift', 'Jolly', 'Rainbow', 'Cyber', 'Neon',
        'Thunder', 'Storm', 'Lava', 'Crystal', 'Iron', 'Silver', 'Red', 'Blue', 'Green', 'Purple', 'Sleepy', 'Funky', 'Spicy',
        'Chill', 'Mighty', 'Little', 'Secret', 'Bouncy', 'Sparkly'],
    noun: ['Champion', 'Horse', 'Gorilla', 'Dragon', 'Tiger', 'Panda', 'Wolf', 'Fox', 'Cat', 'Kitty', 'Dog', 'Doge', 'Bunny',
        'Penguin', 'Shark', 'Knight', 'Wizard', 'Ninja', 'Gamer', 'Player', 'Slapper', 'Master', 'King', 'Queen', 'Hero', 'Boss',
        'Potato', 'Cookie', 'Pizza', 'Taco', 'Nugget', 'Banana', 'Llama', 'Unicorn', 'Bear', 'Lion', 'Eagle', 'Phoenix',
        'Robot', 'Builder', 'Hunter', 'Blade', 'Comet', 'Rocket', 'Pickle', 'Muffin', 'Bacon', 'Frog', 'Duck', 'Hamster',
        'Raccoon', 'Sloth', 'Turtle', 'Owl', 'Monkey', 'Cactus', 'Donut', 'Waffle', 'Glove', 'Legend', 'Slime',
        'Ghost', 'Pirate', 'Viking', 'Samurai', 'Pancake'],
    first: ['Alex', 'Max', 'Leo', 'Mia', 'Emma', 'Lily', 'Jake', 'Noah', 'Ava', 'Zoe', 'Ryan', 'Sam', 'Ethan', 'Mason', 'Ella',
        'Ruby', 'Liam', 'Chloe', 'Owen', 'Lucas', 'Jack', 'Ben', 'Kai', 'Luna', 'Nova', 'Finn', 'Milo', 'Ivy', 'Jay', 'Tom'],
    tag: ['YT', 'TV', 'Gaming', 'Pro', 'HD', 'RBLX', 'XD', 'Official', 'Plays', 'GG'],
};
const BOT_NAME_RU = {
    first: ['Маша', 'Даша', 'Саша', 'Кирилл', 'Даня', 'Ваня', 'Миша', 'Артём', 'Лиза', 'Настя', 'Соня', 'Полина', 'Егор', 'Максим',
        'Тимур', 'Арина', 'Вика', 'Алиса', 'Ксюша', 'Глеб', 'Матвей', 'Лёша', 'Дима', 'Никита', 'Катя', 'Вова', 'Серёжа', 'Аня',
        'Ева', 'Тёма', 'Илья', 'Рома', 'Женя', 'Олег', 'Милана', 'Варя', 'Лера', 'Стёпа', 'Ярик', 'Тимоха'],
    tag: ['Про', 'Топ', 'Бро', 'Крут', 'Босс', 'ГГ', 'Изи', 'Лучший', 'Шлеп'],
    adj: ['Злой', 'Добрый', 'Сонный', 'Быстрый', 'Дикий', 'Мега', 'Супер', 'Тихий', 'Весёлый', 'Хитрый', 'Грозный', 'Пушистый',
        'Ленивый', 'Огненный', 'Ледяной', 'Космо', 'Тёмный', 'Крутой', 'Маленький', 'Великий', 'Золотой'],
    noun: ['Кот', 'Ёж', 'Тапок', 'Пельмень', 'Кабачок', 'Борщ', 'Хомяк', 'Енот', 'Лис', 'Волк', 'Медведь', 'Барсик', 'Пончик',
        'Шлепок', 'Ниндзя', 'Рыцарь', 'Дракон', 'Бублик', 'Огурец', 'Банан', 'Пингвин', 'Мурзик', 'Тигр', 'Сырник'],
    word: ['КотБаюн', 'Пельмешка', 'ТапокБоец', 'СуперКотик', 'Нагибатор', 'ЛадаИвуленок', 'Котлетка', 'Пончик', 'Бублик', 'Кексик',
        'Шлёпыч', 'Пушистик', 'Ёжик', 'Печенька', 'ШлепоКот', 'Тапочек', 'Громобой', 'КапитанПельмень', 'Ватрушка', 'Огурчик',
        'Медвежонок', 'Лисёнок', 'ХомякБоец', 'Котофей', 'Колобок', 'Кузя', 'Сырок', 'Пирожок', 'Карамелька',
        'Зефирка', 'Шаурмен', 'Бутерброд', 'Котёнок'],
};
const BOT_NAME_TR = {
    first: ['Vanya', 'Kirill', 'Dimon', 'Sasha', 'Masha', 'Dasha', 'Nikita', 'Egor', 'Artem', 'Liza', 'Nastya', 'Sonya', 'Timur',
        'Gleb', 'Matvey', 'Lesha', 'Misha', 'Vova', 'Ksusha', 'Arina', 'Polina', 'Danya', 'Tema', 'Ilya', 'Vika', 'Roma', 'Zhenya',
        'Stepa', 'Yarik', 'Maks'],
    word: ['Nagibator', 'Pelmeshka', 'KotBayun', 'Tapok', 'Gonzik', 'Borsch', 'Kotleta', 'Pirozhok', 'Ponchik', 'Barsik', 'Murzik',
        'Kabachok', 'Ezhik', 'Medved', 'Kolobok', 'Bublik', 'Syrok', 'Pryanik', 'Ogurchik', 'Kuzya', 'Vatrushka'],
    tag: ['pro', 'top', 'krut', 'boss', 'bro', 'gg', 'ez', 'king', 'YT'],
};

// Реплики чата: категория -> { mood: +1 радость / −1 досада / 0, ru, en }. {player}, {name},
// {friend}, {glove}, {n} — подстановки. Без грубостей.
/** @type {Record<string, { mood: number, ru: string[], en: string[] }>} */
const BOT_CHAT = {
    greet: { mood: 1, ru: ['привет', 'всем привет', 'прив', 'хай', 'ку', 'здарова', 'приветик', 'hi', 'всем ку', 'хеллоу', 'хаюшки'],
        en: ['hi', 'hello', 'hey guys', 'yo', 'hii', 'sup', 'hey', 'hello everyone'] },
    newPlayer: { mood: 1, ru: ['привет {player}', 'о, новенький', 'хай {player}', 'привет', '{player} го дружить', 'ку {player}', 'hi'],
        en: ['hi {player}', 'oh a new guy', 'hey {player}', 'hello', 'yo {player}', 'hi'] },
    arenaJoin: { mood: 0, ru: ['го', 'ну что, начнём', 'кто тут самый сильный?', 'всем привет', 'я пришёл фармить ауру', 'hi', 'го драться'],
        en: ['lets go', 'who is the strongest here?', 'hi all', 'time to farm aura', 'hi'] },
    koWin: { mood: 1, ru: ['ez', 'изи', 'гг', 'лол', 'хахаха', 'пока', 'байбай', 'изи изи', 'легко', 'улетел', 'хахах полетел', 'gg', 'лови',
        'ахаха', 'ещё один', 'пока-пока'], en: ['ez', 'gg', 'lol', 'bye', 'cya', 'too easy', 'haha', 'bye bye', 'yeet', 'see ya'] },
    koPlayer: { mood: 1, ru: ['ez', 'гг', 'изи', 'лол', 'сорян', 'хаха', 'пока-пока', 'не обижайся', 'улетел {player}', 'гг {player}'],
        en: ['ez', 'gg', 'lol', 'sorry', 'haha', 'bye {player}', 'gg {player}'] },
    fanSorry: { mood: 0, ru: ['ой сорри', 'прости(((', 'я случайно', '{player} сорри', 'ой'], en: ['oh sorry', 'sorry!!', 'oops my bad', 'sorry {player}'] },
    koLose: { mood: -1, ru: ['ну блин', 'за что', 'нечестно', 'лаги!!', 'эй!', 'ну всё', 'я лагал', 'обидно', 'ааа', 'bruh', 'кто меня скинул',
        'опять', 'да ну', 'я не успел', '😭'], en: ['bruh', 'nooo', 'why', 'lag!!', 'not fair', 'hey!', 'ugh', 'who did that', 'again??', 'i lagged'] },
    selfFall: { mood: 0, ru: ['упс', 'ой', 'я сам упал лол', 'ахах я дурак', 'блин', 'ну и ладно', 'случайно', 'оййй', 'не туда пошёл', 'лол'],
        en: ['oops', 'oof', 'lol i fell', 'whoops', 'my bad', 'nooo'] },
    hit: { mood: -1, ru: ['эй!', 'за что?!', 'ай', 'ну ты', 'хватит', 'больно', 'ауч', 'стоп', 'не бей', 'отстань', '😡'],
        en: ['hey!', 'why', 'ouch', 'stop', 'bruh', 'rude', 'ow', '😡'] },
    revenge: { mood: -1, ru: ['ну всё', 'тебе конец', 'иди сюда', 'щас отомщу', 'ты попал', 'стой!', 'я тебя запомнил', '{name} иди сюда',
        '{name} ну держись', 'щас получишь'], en: ['come here', 'you are done', 'revenge time', 'get back here', '{name} come here', 'oh its on'] },
    afkGo: { mood: 0, ru: ['афк', 'щас приду', 'я отойду', 'brb', 'афк 5 мин'], en: ['afk', 'brb', 'one sec'] },
    afkBack: { mood: 0, ru: ['я тут', 'сорри был афк', 'вернулся', 'кто меня трогал пока я был афк', 'я отходил', 'мама звала', 'я вернулся', 'бэк'],
        en: ['back', 'im back', 'sorry was afk', 'who slapped me while i was afk', 'back!!'] },
    arena: { mood: 0, ru: ['кто дуэль?', 'у меня 1000 ауры', 'как получить бомбу?', 'го в королевскую', 'не бейте меня пж', 'кто со мной в команду?',
        'я новенький', 'эта игра топ', 'как получить алмазную?', 'го дружить', 'фармлю ауру', 'лагает', 'кто хочет 1 на 1', 'не толкайтесь',
        'я король арены', 'сколько у вас ауры?', 'кто с телефона?', 'аура фарм', 'хаха', 'лол', 'давайте дружить', 'кто сильнее меня?',
        'осторожно край', 'я чуть не упал', 'у кого гигант?'],
        en: ['anyone duel?', 'i have 1000 aura', 'how do i get the bomb?', 'lets go royale', 'pls dont slap me', 'team?', 'im new',
        'this game is fire', 'how to get diamond glove?', 'aura farm', 'lag', '1v1?', 'lol', 'friends?', 'careful the edge', 'who has giant glove?'] },
    lobby: { mood: 0, ru: ['какую перчатку брать?', 'го на арену', 'кто в королевскую?', 'у кого есть гигант?', 'как получить чёрную дыру?',
        'сколько ауры надо на бомбу?', 'кто с телефона?', 'го дуэль', 'кто в хардкор?', 'я за аурой', 'дайте ауры пж', 'кто тут топ 1?',
        'хочу алмазную перчатку', 'го все на арену', 'хардкор страшный', 'я тут каждый день', 'кто знает секрет?', 'как быстро набрать ауру?'],
        en: ['which glove is best?', 'arena anyone?', 'royale?', 'who has giant?', 'how to get black hole?', 'duel anyone?', 'hardcore?',
        'who is top 1?', 'i want diamond glove', 'how to farm aura fast?'] },
    hardcore: { mood: 0, ru: ['тут жёстко', 'хардкор топ', 'x2 аура!!', 'тут все сильные', 'ну и хардкор', 'аура х2 го фармить', 'кто выжил тот красавчик'],
        en: ['this is hard', 'hardcore is fun', 'x2 aura!!', 'everyone is so strong here'] },
    royale: { mood: 0, ru: ['остров падает!!', 'все в центр', 'я выживу', 'только не край', 'кто последний?', 'не толкайте', 'давайте не драться пж',
        'я буду первым'], en: ['the island is falling!!', 'go center', 'ill survive', 'not the edge', 'pls no fighting'] },
    duelStart: { mood: 0, ru: ['gl', 'удачи', 'го', 'ну давай', 'gl hf', 'готов?', 'я не проиграю'], en: ['gl', 'good luck', 'gl hf', 'ready?', 'lets go'] },
    duelWin: { mood: 1, ru: ['gg', 'гг изи', 'gg ez', 'изи', 'норм играешь', 'гг вп', 'реванш?'], en: ['gg', 'gg ez', 'ez', 'gg wp', 'rematch?'] },
    duelTalk: { mood: 0, ru: ['давай', 'ну иди сюда', 'хаха', 'не убежишь', 'ты хорош'], en: ['come on', 'haha', 'you cant run', 'youre good'] },
    gloveTry: { mood: 1, ru: ['имба', 'норм перчатка', 'о, классная', 'беру', 'вот это сила', 'красивая', 'топ', '{glove} топ'],
        en: ['op', 'nice glove', 'cool', 'taking it', 'so strong', '{glove} is the best'] },
    gloveWant: { mood: 0, ru: ['мне не хватает ауры', 'надо ещё {n} ауры', 'как получить {glove}?', 'хочу {glove}', 'скоро возьму {glove}',
        'ещё {n} ауры и {glove} моя'], en: ['i need more aura', 'need {n} more aura', 'how to get {glove}?', 'i want {glove}', 'soon {glove} will be mine'] },
    glovePlayer: { mood: 1, ru: ['о, {glove}', 'крутая перчатка', 'у тебя {glove}?', 'имба', 'как ты её получил?', 'хочу такую же'],
        en: ['oh {glove}', 'cool glove', 'you have {glove}?', 'op', 'how did you get it?'] },
    board: { mood: 0, ru: ['я в топе!', 'как они столько набрали', 'хочу в топ', 'кто первый?', 'я скоро там буду', 'вау сколько ауры'],
        en: ['im on the board!', 'how do they have so much', 'i want to be top', 'who is first?'] },
    fan: { mood: 1, ru: ['{player} привет!', '{player} го дружить', '{player} ты крутой', '{player} научи', 'можно с тобой?', '{player} я твой фанат',
        '{player} подожди меня'], en: ['{player} hi!', '{player} friends?', '{player} youre so cool', '{player} teach me', 'can i come with you?', '{player} im your fan'] },
    friend: { mood: 0, ru: ['{friend} го сюда', '{friend} пошли', '{friend} давай вместе', '{friend} ты где', '{friend} смотри'],
        en: ['{friend} come here', '{friend} lets go', '{friend} together', '{friend} where are you'] },
    friendHelp: { mood: -1, ru: ['{friend} держись!', 'не трогай {friend}', '{friend} я помогу', 'эй это мой друг'],
        en: ['{friend} hold on!', 'leave {friend} alone', 'hey thats my friend'] },
    leave: { mood: 0, ru: ['мне пора', 'пока всем', 'bye', 'всё, ушёл', 'мама зовёт', 'спать пора', 'пока'], en: ['gtg', 'bye all', 'bye', 'gotta go', 'cya'] },
    phonk: { mood: 0, ru: ['ЧТО', 'АААА', 'фонк!!', 'что это было', 'ааааа', '😱', '💀'], en: ['WHAT', 'AAAA', 'phonk!!', 'what was that', '😱', '💀'] },
    playerFell: { mood: 1, ru: ['лол', 'хаха', 'он сам упал', 'ахах', 'упал сам'], en: ['lol', 'haha', 'he just fell', 'lmao'] },
    goArena: { mood: 0, ru: ['го на арену', 'я на арену', 'кто со мной на арену?'], en: ['arena time', 'going to arena', 'who comes to arena?'] },
    goRoyale: { mood: 0, ru: ['го в королевскую', 'я в королевскую битву'], en: ['going royale', 'royale anyone?'] },
    goHardcore: { mood: 0, ru: ['я в хардкор', 'кто в хардкор?', 'хардкор го'], en: ['going hardcore', 'hardcore?'] },
    goDuel: { mood: 0, ru: ['кто дуэль?', 'го дуэль', 'я на дуэль'], en: ['anyone duel?', 'duel time'] },
};
const BOT_EMOJI_POS = ['😎', '😂', '🔥', '😏', '👋', '💪', '😁'];
const BOT_EMOJI_NEG = ['😡', '😭', '💀', '😤', '😢'];

// --- Мелкие помощники (глобальные имена с префиксом bots) ---

function botsRand(a, b) { return a + Math.random() * (b - a); }
/** @template T @param {T[]} a @returns {T} */
function botsPick(a) { return a[Math.floor(Math.random() * a.length)]; }
function botsClamp(v, a, b) { return v < a ? a : v > b ? b : v; }

// Ключ по весам { key: weight }.
/** @param {Record<string, number>} w @returns {string} */
function botsWeighted(w) {
    let sum = 0;
    for (const k in w) sum += Math.max(0, w[k]);
    let r = Math.random() * sum;
    for (const k in w) { r -= Math.max(0, w[k]); if (r < 0) return k; }
    for (const k in w) if (w[k] > 0) return k;
    return Object.keys(w)[0];
}

// Цифры ника: год, «мемное» число или 1–4 случайные.
function botsDigits() {
    const r = Math.random();
    if (r < 0.25) return String(2008 + Math.floor(Math.random() * 10));
    if (r < 0.35) return botsPick(['228', '777', '1337', '007', '123', '999', '100', '2000', '3000']);
    const len = 1 + Math.floor(Math.random() * 3.3);
    let s = String(1 + Math.floor(Math.random() * 9));
    while (s.length < len) s += Math.floor(Math.random() * 10);
    return s;
}

// Опечатка: перестановка, удвоение или пропуск буквы (подстановки {…} не трогает).
function botsTypo(s) {
    const a = Array.from(s), idx = [];
    let depth = 0;
    for (let i = 0; i < a.length; i++) {
        if (a[i] === '{') depth++;
        else if (a[i] === '}') depth--;
        else if (!depth && /[a-zа-яё]/i.test(a[i])) idx.push(i);
    }
    if (idx.length < 4) return s;
    const i = idx[1 + Math.floor(Math.random() * (idx.length - 2))];
    const op = Math.random();
    if (op < 0.35 && i + 1 < a.length && /[a-zа-яё]/i.test(a[i + 1])) { const t = a[i]; a[i] = a[i + 1]; a[i + 1] = t; }
    else if (op < 0.65) a.splice(i, 0, a[i]);
    else a.splice(i, 1);
    return a.join('');
}

function botsHex(v) {
    if (typeof v === 'string') return v;
    return '#' + ((Number(v) >>> 0) & 0xffffff).toString(16).padStart(6, '0');
}

// Смешать цвета 0xRRGGBB: k = 0 — a, 1 — b.
function botsMix(a, b, k) {
    const A = typeof a === 'number' ? a : parseInt(String(a).replace('#', ''), 16) || 0;
    const ch = (s) => Math.round(((A >> s) & 255) * (1 - k) + ((b >> s) & 255) * k);
    return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/**
 * Состояние ИИ бота (лежит в GameBots.bots и char.data.bot).
 * @param {Character} c @param {string} zone @param {string} kind @param {number} skill
 * @param {boolean} respawn @param {boolean} hardcore @param {boolean} ru
 */
function botsBrain(c, zone, kind, skill, respawn, hardcore, ru) {
    const t = Game.time, rt = Game.realTime, s = skill;
    const edge = (BOT_EDGE_MIN + BOT_EDGE_SKILL * s) * (kind === 'careful' ? 1.45 : kind === 'newbie' ? 0.6 : 1);
    return {
        c, zone, kind, skill: s, respawn, hardcore, ru,
        // Стиль: чат и «почерк» движения.
        typo: Math.random() * (0.35 - 0.25 * s),
        caps: Math.random() < 0.16 ? 0.2 + Math.random() * 0.3 : Math.random() * 0.04,
        smile: Math.random(),
        paren: ru ? Math.random() * 0.6 : 0,
        noise: (0.05 + 0.3 * (1 - s)) * (0.6 + Math.random() * 0.8),
        turnK: 3.5 + 6 * s + Math.random() * 2,
        edgeM: edge,
        wob: Math.random() * 6.28,
        wobF: 0.8 + Math.random() * 1.6,
        side: Math.random() < 0.5 ? -1 : 1,
        // Решения.
        act: 'idle',
        thinkAt: t + Math.random() * 0.6,
        reactAt: 0,
        slapAt: 0,
        jumpAt: t + 3 + Math.random() * 12,
        /** @type {Character | null} */
        target: null,
        /** @type {Character | null} */
        follow: null,
        gx: c.x, gy: c.y, goalR: 90, goalD: Infinity, thr: 1, waitUntil: 0,
        flank: false, faceLock: false, spacing: false, strafe: 1, strafeK: 0.5, orbit: 0.7, reachK: 0.9,
        mx: 0, my: 0,
        // Память и отношения.
        /** @type {Character | null} */
        grudge: null,
        grudgeUntil: 0,
        /** @type {Character | null} */
        friend: null,
        leader: false,
        afkAt: kind === 'afk' ? t + 2 + Math.random() * 20 : 0,
        afkUntil: 0,
        lapseUntil: 0,
        recover: false,
        unstuckUntil: 0, ux: 0, uy: 0, stuckT: 0, lastX: c.x, lastY: c.y, lastT: t,
        /** @type {{ x: number, y: number, id: string | null, need: number } | null} */
        ped: null,
        /** @type {any} */
        portal: null,
        portalStage: 0,
        portalMode: '',
        lobbyUntil: rt + botsRand(BOT_LOBBY_STAY_MIN, BOT_LOBBY_STAY_MAX),
        sessionUntil: rt + botsRand(BOT_SESSION_MIN, BOT_SESSION_MAX),
        respawnAt: 0,
        quitting: false,
        leaving: false,
        chatAt: 0,
        pending: '',
        kills: 0,
        deaths: 0,
        /** @type {any[]} */
        cols: [],
    };
}
/** @typedef {ReturnType<typeof botsBrain>} BotState */

/** @satisfies {Record<string, any>} */
const GameBots = {
    /** @type {Map<Character, BotState>} */
    bots: new Map(),
    /** @type {Record<string, { count: number, opts: any }>} */
    targets: {},
    /** @type {Record<string, boolean>} */
    frozen: {},
    /** @type {Record<string, number>} */
    _joinAt: {},
    /** @type {Record<string, number>} */
    _leaveAt: {},
    /** @type {Set<string>} */
    _names: new Set(),
    /** @type {Array<{ at: number, fn: Function }>} */
    _timers: [],
    /** @type {string[]} */
    _recent: [],
    _chatAt: 0,
    _idleChatAt: 0,
    _noticeAt: 0,
    _popAt: 0,
    _onPlayer: 0,
    _team: 0,
    /** @type {Record<string, HTMLImageElement>} */
    _faces: {},
    /** @type {Record<string, string>} */
    _avCache: {},
    _avDirty: false,
    _avAt: 0,
    _v: { x: 0, y: 0 },
    _g: { x: 0, y: 0 },
    _o: { x: 0, y: 0 },
    stats: { t0: 0, slaps: 0, misses: 0, kos: 0, falls: 0, selfFalls: 0, stuck: 0, joins: 0, leaves: 0, portals: 0, chats: 0 },

    // --- Жизненный цикл ----------------------------------------------------------------

    init(game) {
        this.stats.t0 = Game.realTime;
        this._loadFaces();
        Game.on('slap', (e) => this._onSlap(e));
        Game.on('miss', (e) => { if (e.char && this.bots.has(e.char)) this.stats.misses++; });
        Game.on('ko', (e) => this._onKo(e));
        Game.on('respawn', (e) => this._onRespawn(e));
        Game.on('despawn', (e) => { if (e.char) this.bots.delete(e.char); });
        Game.on('round', (e) => this._onRound(e));
        Game.on('phonk', (e) => {
            const b = e && e.victim ? this.bots.get(e.victim) : null;
            if (b && Math.random() < 0.35) this._say(b, 'phonk', null, true);
        });
        Game.on('start', () => this._greetPlayer('lobby', botsRand(1.5, 3)));
        Game.on('glove', (e) => this._onGlove(e));
        // Зона ауры переехала — боты заново решают, куда идти.
        Game.on('zoneMove', () => { for (const b of this.bots.values()) { if (b.act === 'wander') { b.act = 'idle'; b.thinkAt = Game.time + botsRand(0, 1.2); } } });
        this._idleChatAt = Game.realTime + botsRand(BOT_IDLE_CHAT_MIN, BOT_IDLE_CHAT_MAX);
        void game;
    },

    ready() {
        const d = Game.debug;
        if (!d) return;
        d.bots = () => JSON.stringify(this.report());
        d.botsReset = () => { this.resetStats(); return true; };
    },

    update(dt, realDt) {
        const rt = Game.realTime;
        if (this._timers.length) {
            const due = this._timers.filter(t => rt >= t.at);
            if (due.length) {
                this._timers = this._timers.filter(t => rt < t.at);
                for (const t of due) { try { t.fn(); } catch (e) { console.error('GameBots: таймер', e); } }
            }
        }
        if (rt >= this._popAt) { this._popAt = rt + 0.5; this._maintain(); }
        if (this._avDirty && rt >= this._avAt) { this._avDirty = false; this._avAt = rt + 0.5; this._refreshAvatars(); }
        const now = Game.time, p = Game.player;
        let onP = 0;
        for (const b of this.bots.values()) if (b.act === 'fight' && b.target && b.target === p && b.c.state !== 'dead') onP++;
        this._onPlayer = onP;
        let thinks = 0;
        for (const b of Array.from(this.bots.values())) {
            const c = b.c;
            if (c.disposed) { this.bots.delete(c); continue; }
            if (c.state === 'dead') { this._deadStep(b); continue; }
            if (this.frozen[b.zone]) {
                if (c.moveX || c.moveY) c.setMove(0, 0);
                b.mx = b.my = 0;
                if (now >= b.thinkAt) { b.thinkAt = now + botsRand(0.6, 1.4); this._frozenIdle(b); }
                continue;
            }
            if (b.leaving) { if (c.moveX || c.moveY) c.setMove(0, 0); continue; }
            if (now >= b.thinkAt && thinks < BOT_THINKS_PER_FRAME) { thinks++; this._think(b); }
            if (!c.disposed && this.bots.has(c)) this._steer(b, dt);
        }
        this._idleChat();
        void realDt;
    },

    // Игрок перешёл в зону: на арене кто-нибудь здоровается, в дуэли — «gl».
    onZone(zone, mode) {
        if (zone === 'arena' && Math.random() < 0.5) this._greetPlayer('arena', botsRand(2.5, 5));
        if (mode === 'duel') {
            this._later(botsRand(1.6, 2.6), () => {
                for (const b of this.bots.values()) if (b.zone === 'duel' && Math.random() < 0.6) this._say(b, 'duelStart');
            });
        }
    },

    // --- API ---------------------------------------------------------------------------

    // Держать count ботов в зоне (opts: { hardcore, skill } — базовое умение). Пустая зона
    // заполняется сразу (боты «уже играли»), дальше — входы/выходы по одному.
    populate(zone, count, opts) {
        const z = zone === 'hardcore' ? 'arena' : String(zone || Game.zone);
        const o = Object.assign({}, opts || {});
        if (zone === 'hardcore') o.hardcore = true;
        const n = Math.max(0, Math.floor(Number(count) || 0));
        this.targets[z] = { count: n, opts: o };
        this._joinAt[z] = 0;
        const cur = this._count(z);
        if (n > 0 && cur === 0) this._fill(z, n, o);
        else if (cur > n && (z !== Game.zone || !Game.started)) this._trim(z, cur - n, false);
        return this.list(z);
    },

    // Новый бот в зоне. opts: { x, y, heading, skill 0..1, aura, glove, respawn (true),
    // personality, name, hardcore, team } (+ внутренние: scatter — случайная точка зоны,
    // join — точка входа и защита появления, baseSkill — умение populate).
    spawnBot(zone, opts) {
        const o = opts || {};
        let z = String(zone || Game.zone);
        let hardcore = !!o.hardcore;
        if (z === 'hardcore') { z = 'arena'; hardcore = true; }
        let x = o.x, y = o.y, heading = o.heading;
        if (x == null || y == null) {
            const sp = o.scatter ? this._scatterPoint(z) : this._spawnPoint(z);
            if (!sp) return null;
            x = sp.x; y = sp.y;
            if (heading == null) heading = sp.heading;
        }
        if (heading == null) heading = Math.random() * Math.PI * 2;
        const kind = o.personality || this._pickKind(z, hardcore);
        const ruName = Lang.code === 'ru';   // русская версия (Яндекс, RuStore) — русские ники, английская — латиница
        const name = o.name ? this._claim(String(o.name)) : this._name(ruName);
        const ru = Lang.code === 'ru' && (ruName || Math.random() < 0.65);
        const aura = o.aura != null ? Math.max(0, Math.round(Number(o.aura) || 0)) : this._pickAura(hardcore, kind);
        let skill;
        if (o.skill != null) skill = botsClamp(Number(o.skill) || 0, 0, 1);
        else if (o.baseSkill != null) skill = botsClamp(Number(o.baseSkill) + botsRand(-0.07, 0.08) - (kind === 'newbie' ? 0.12 : 0), 0.05, 0.95);
        else skill = botsClamp(this._pickSkill(kind, hardcore) + 0.05 * Math.log10(aura + 1) - 0.06, 0.05, 0.95);
        const look = this._look(aura, kind);
        const glove = o.glove || this._gloveFor(aura);
        const c = new Character({ name, isBot: true, zone: z, x, y, heading, look, glove, team: o.team || null });
        c.aura = aura;
        c.avatar = this._avatar(look);
        c.speedMul = botsClamp(botsRand(BOT_SPEED_MIN, BOT_SPEED_MAX) + (hardcore ? 0.03 : 0) - (kind === 'newbie' ? 0.04 : 0) + 0.04 * (skill - 0.5), 0.8, 1);
        const b = botsBrain(c, z, kind, skill, o.respawn !== false, hardcore, ru);
        if (z === 'royale') b.edgeM += 40;
        c.data.bot = b;
        this.bots.set(c, b);
        if (o.join && Game.pvp(z)) c.shieldUntil = Game.time + GameCfg.spawnShield;
        Game.addChar(c);
        return c;
    },

    // Убрать бота сразу (без строки «вышел»).
    remove(bot) {
        if (!bot) return;
        const b = this.bots.get(bot);
        if (b) { this._remove(b, false, true); return; }
        if (!bot.disposed) { if (Game.chars.indexOf(bot) >= 0) Game.removeChar(bot); else bot.dispose(); }
    },

    // Убрать всех ботов зоны (без zone — всех). Цель населения не меняется.
    clear(zone) {
        const z = zone === 'hardcore' ? 'arena' : zone;
        for (const b of Array.from(this.bots.values())) if (!z || b.zone === z) this._remove(b, false, true);
        if (z) this._joinAt[z] = 0; else this._joinAt = {};
    },

    // Заморозка зоны (отсчёт раунда): боты стоят, не бьют; после — каждый «очнётся» со своей реакцией.
    freeze(zone, on) {
        const z = zone === 'hardcore' ? 'arena' : zone;
        const was = !!this.frozen[z];
        this.frozen[z] = !!on;
        const now = Game.time;
        for (const b of this.bots.values()) {
            if (b.zone !== z) continue;
            b.mx = b.my = 0;
            b.c.setMove(0, 0);
            if (on) { b.target = null; b.act = 'idle'; b.thinkAt = now + botsRand(0.5, 1.5); }
            else if (was) {
                b.reactAt = now + this._reaction(b) + Math.random() * 0.25;
                b.slapAt = b.reactAt;
                b.thinkAt = now + Math.random() * 0.3;
            }
        }
    },

    isFrozen(zone) { return !!this.frozen[zone === 'hardcore' ? 'arena' : zone]; },

    // Боты зоны (без zone — все).
    list(zone) {
        const z = zone === 'hardcore' ? 'arena' : zone;
        const out = [];
        for (const b of this.bots.values()) if (!z || b.zone === z) out.push(b.c);
        return out;
    },

    // Отладка (Game.debug.spawnBots): n ботов вокруг игрока в его зоне.
    spawn(n) {
        const p = Game.player, zone = Game.zone, cnt = Math.max(1, Math.floor(Number(n) || 4));
        if (this.targets[zone]) this.targets[zone].count += cnt;   // иначе население «уберёт лишних»
        for (let i = 0; i < cnt; i++) {
            let pt = null;
            for (let k = 0; k < 20 && !pt && p; k++) {
                const a = Math.random() * Math.PI * 2, r = 300 + Math.random() * 600;
                const x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r;
                if (GameWorld.edgeDist(x, y, zone) > 220 && !this._inCollider(x, y)) pt = { x, y };
            }
            if (!pt) pt = this._spawnPoint(zone);
            if (pt) this.spawnBot(zone, { x: pt.x, y: pt.y, heading: p ? Math.atan2(p.y - pt.y, p.x - pt.x) : 0, join: true });
        }
        return Game.chars.length;
    },

    // Счётчики для отладки и проверки: шлепки в минуту, KO, самопадения, «застревания».
    report() {
        const s = this.stats, min = Math.max(1 / 60, (Game.realTime - s.t0) / 60);
        /** @type {Record<string, number>} */
        const zones = {};
        for (const b of this.bots.values()) zones[b.zone] = (zones[b.zone] || 0) + 1;
        /** @type {Record<string, number>} */
        const targets = {};
        for (const z in this.targets) targets[z] = this.targets[z].count;
        return {
            minutes: +min.toFixed(2), slaps: s.slaps, slapsPerMin: +(s.slaps / min).toFixed(1), misses: s.misses, kos: s.kos,
            falls: s.falls, selfFalls: s.selfFalls, stuck: s.stuck, joins: s.joins, leaves: s.leaves, portals: s.portals, chats: s.chats,
            onPlayer: this._onPlayer, zones, targets, frozen: Object.keys(this.frozen).filter(k => this.frozen[k]),
            bots: Array.from(this.bots.values()).map(b => ({ name: b.c.name, kind: b.kind, skill: +b.skill.toFixed(2), aura: b.c.aura,
                glove: b.c.glove, zone: b.zone, act: b.act, state: b.c.state, target: b.target ? b.target.name : null })),
        };
    },

    resetStats() {
        const s = this.stats;
        for (const k in s) s[k] = 0;
        s.t0 = Game.realTime;
    },

    // --- Население ------------------------------------------------------------------------

    _count(zone) {
        let n = 0;
        for (const b of this.bots.values()) if (b.zone === zone && !b.leaving) n++;
        return n;
    },

    _needs(zone) {
        const t = this.targets[zone];
        return !!t && this._count(zone) < t.count;
    },

    _popOpts(o) { return { hardcore: !!(o && o.hardcore), baseSkill: o && o.skill != null ? o.skill : undefined }; },

    // Сразу n ботов по зоне (иногда пара друзей).
    _fill(zone, n, o) {
        let left = n;
        while (left > 0) {
            if (left >= 2 && zone !== 'duel' && Math.random() < 0.14) { this._spawnPair(zone, o, true); left -= 2; continue; }
            this.spawnBot(zone, Object.assign(this._popOpts(o), { scatter: true }));
            left--;
        }
    },

    // Пара друзей: общая команда (не бьют друг друга), ведущий и ведомый.
    _spawnPair(zone, o, scatter) {
        const team = 'friends' + (++this._team);
        const a = this.spawnBot(zone, Object.assign(this._popOpts(o), { scatter, join: !scatter, personality: 'friend', team }));
        if (!a) return [];
        let x = a.x, y = a.y;
        for (let k = 0; k < 10; k++) {
            const ang = Math.random() * Math.PI * 2, r = 120 + Math.random() * 120;
            const tx = a.x + Math.cos(ang) * r, ty = a.y + Math.sin(ang) * r;
            if (GameWorld.edgeDist(tx, ty, zone) > 220 && !this._inCollider(tx, ty)) { x = tx; y = ty; break; }
        }
        const c2 = this.spawnBot(zone, Object.assign(this._popOpts(o), { x, y, heading: a.heading, join: !scatter, personality: 'friend', team }));
        const ba = this.bots.get(a), bb = c2 ? this.bots.get(c2) : null;
        if (ba && bb) { ba.friend = c2; bb.friend = a; ba.leader = true; }
        return c2 ? [a, c2] : [a];
    },

    // Раз в 0.5 с: недостающие входят по одному, лишние выходят (при игроке — по одному с паузой).
    _maintain() {
        const rt = Game.realTime;
        for (const zone in this.targets) {
            const T = this.targets[zone].count, n = this._count(zone);
            if (n < T) {
                if (!this._joinAt[zone]) {
                    this._joinAt[zone] = rt + (zone === 'lobby' ? botsRand(BOT_LOBBY_JOIN_MIN, BOT_LOBBY_JOIN_MAX) : botsRand(BOT_JOIN_MIN, BOT_JOIN_MAX));
                } else if (rt >= this._joinAt[zone]) {
                    this._joinAt[zone] = 0;
                    this._join(zone, T - n);
                }
            } else this._joinAt[zone] = 0;
            if (n > T) {
                if (zone !== Game.zone || !Game.started) this._trim(zone, n - T, false);
                else if (rt >= (this._leaveAt[zone] || 0)) { this._leaveAt[zone] = rt + botsRand(1, 3); this._trim(zone, 1, true); }
            }
        }
    },

    // Новый «игрок» входит в зону (у точки появления): строка в ленте, иногда — «привет».
    _join(zone, room) {
        const o = this.targets[zone] ? this.targets[zone].opts : {};
        const made = room >= 2 && Math.random() < 0.15 ? this._spawnPair(zone, o, false)
            : [this.spawnBot(zone, Object.assign(this._popOpts(o), { join: true }))];
        for (const c of made) {
            if (!c) continue;
            this.stats.joins++;
            this._notice('botJoined', c.name);
            const b = this.bots.get(c);
            if (b && Math.random() < 0.3) this._later(botsRand(2, 5), () => this._say(b, zone === 'lobby' ? 'greet' : 'arenaJoin'));
        }
    },

    // Убрать k лишних: сначала упавших, потом AFK, потом дальних от игрока.
    _trim(zone, k, notice) {
        const p = Game.player;
        const list = Array.from(this.bots.values()).filter(b => b.zone === zone && !b.leaving);
        const score = (b) => (b.c.state === 'dead' ? 0 : b.act === 'afk' ? 1 : 2) * 1e6 - (p ? Math.min(9e5, Math.hypot(b.c.x - p.x, b.c.y - p.y)) : 0);
        list.sort((a, b) => score(a) - score(b));
        for (let i = 0; i < k && i < list.length; i++) this._remove(list[i], notice);
    },

    _remove(b, notice, silent) {
        const c = b.c;
        this.bots.delete(c);
        if (b.friend) {
            const f = this.bots.get(b.friend);
            if (f && f.friend === c) { f.friend = null; f.leader = true; }
        }
        if (notice) this._notice('botLeft', c.name);
        if (!silent) this.stats.leaves++;
        if (!c.disposed) { if (Game.chars.indexOf(c) >= 0) Game.removeChar(c); else c.dispose(); }
    },

    // Выход из игры «по-человечески»: иногда «пока всем», через секунду — исчез.
    _quit(b) {
        b.leaving = true;
        b.target = null;
        b.act = 'idle';
        if (Math.random() < 0.3) this._say(b, 'leave');
        this._later(botsRand(0.8, 2), () => { if (this.bots.get(b.c) === b) this._remove(b, true); });
    },

    // Упавший бот: через 3–8 с — снова в игре (или «вышел», если так решил / зона переполнена).
    _deadStep(b) {
        if (!b.respawn || !b.respawnAt || Game.realTime < b.respawnAt) return;
        b.respawnAt = 0;
        const t = this.targets[b.zone];
        if (b.quitting || (t && this._count(b.zone) > t.count) || (Game.pvp(b.zone) && Game.realTime > b.sessionUntil)) {
            this._remove(b, true);
            return;
        }
        const sp = this._spawnPoint(b.zone);
        if (!sp) { this._remove(b, false); return; }
        if (Math.random() < 0.25) this._setGlove(b.c, this._gloveFor(b.c.aura), false);
        b.c.respawn(sp.x, sp.y, sp.heading);
    },

    // --- Точки ------------------------------------------------------------------------------

    // Точка появления: маркер зоны подальше от живых персонажей + разброс на полу.
    _spawnPoint(zone) {
        const name = { lobby: 'spawn', arena: 'arena-spawn', royale: 'royale-spawn', duel: 'duel-b' }[zone];
        const n = name ? GameWorld.markers(name).length : 0;
        if (!n) {
            const pt = this._randomPoint(zone, null, 0, 300);
            return pt ? { x: pt.x, y: pt.y, heading: Math.random() * Math.PI * 2 } : null;
        }
        let best = null, bd = -1;
        for (let i = 0; i < n; i++) {
            const sp = GameWorld.spawnPoint(name, i);
            let d = 1e9;
            for (const c of Game.chars) {
                if (c.state === 'dead' || c.zone !== zone) continue;
                d = Math.min(d, Math.hypot(c.x - sp.x, c.y - sp.y));
            }
            d *= 0.6 + Math.random() * 0.8;
            if (d > bd) { bd = d; best = sp; }
        }
        const R = zone === 'lobby' ? 260 : 170;
        for (let k = 0; k < 8; k++) {
            const a = Math.random() * Math.PI * 2, r = Math.random() * R;
            const x = best.x + Math.cos(a) * r, y = best.y + Math.sin(a) * r;
            if (GameWorld.edgeDist(x, y, zone) > 220 && !this._inCollider(x, y)) return { x, y, heading: best.heading + botsRand(-0.6, 0.6) };
        }
        return { x: best.x, y: best.y, heading: best.heading };
    },

    // Случайная точка зоны (боты «уже играли»): в лобби — у маркеров прогулки, не вплотную к игроку.
    _scatterPoint(zone) {
        const p = Game.player;
        const walk = zone === 'lobby' ? GameWorld.markers('lobby-walk') : [];
        for (let k = 0; k < 24; k++) {
            let x, y;
            if (walk.length) { const m = botsPick(walk); x = +m.x + botsRand(-260, 260); y = +m.y + botsRand(-260, 260); }
            else { const pt = this._randomPoint(zone, null, 0, 350); if (!pt) break; x = pt.x; y = pt.y; }
            if (GameWorld.edgeDist(x, y, zone) < 250 || this._inCollider(x, y)) continue;
            if (p && p.zone === zone && Math.hypot(p.x - x, p.y - y) < 380) continue;
            return { x, y, heading: Math.random() * Math.PI * 2 };
        }
        return this._spawnPoint(zone);
    },

    // Случайная точка зоны (рядом с near в радиусе radius) не ближе margin к краю.
    _randomPoint(zone, near, radius, margin) {
        const z = GameWorld.zones[zone];
        if (!z) return near ? { x: near.x, y: near.y } : null;
        for (let k = 0; k < 18; k++) {
            const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * (near ? radius : z.r);
            const x = (near ? near.x : z.x) + Math.cos(a) * r, y = (near ? near.y : z.y) + Math.sin(a) * r;
            if (GameWorld.edgeDist(x, y, zone) >= margin && !this._inCollider(x, y)) return { x, y };
        }
        return { x: z.x, y: z.y };
    },

    _nearPortal(x, y) {
        for (const p of GameWorld.portals) if (Math.hypot(x - p.x, y - p.y) < p.r + 110) return true;
        return false;
    },

    _inCollider(x, y) {
        for (const k of GameWorld.colliders) if (Math.hypot(x - k.x, y - k.y) < k.r + 60) return true;
        return false;
    },

    // Направление «внутрь острова» (рост edgeDist) в точке; общий объект — копировать.
    _inward(x, y, zone) {
        const e = 30, W = GameWorld, out = this._g;
        const gx = W.edgeDist(x + e, y, zone) - W.edgeDist(x - e, y, zone);
        const gy = W.edgeDist(x, y + e, zone) - W.edgeDist(x, y - e, zone);
        const l = Math.hypot(gx, gy);
        if (l > 1e-6 && isFinite(l)) { out.x = gx / l; out.y = gy / l; return out; }
        const z = W.zones[zone];
        const dx = z ? z.x - x : 0, dy = z ? z.y - y : 0, d = Math.hypot(dx, dy) || 1;
        out.x = dx / d; out.y = dy / d;
        return out;
    },

    _outward(x, y, zone) {
        const g = this._inward(x, y, zone);
        this._o.x = -g.x; this._o.y = -g.y;
        return this._o;
    },

    // --- Внешность, ник, аура, перчатка --------------------------------------------------------

    _pickKind(zone, hardcore) {
        let fans = 0;
        for (const b of this.bots.values()) if (b.zone === zone && b.kind === 'fan') fans++;
        /** @type {Record<string, number>} */
        const w = zone === 'lobby' ? { hunter: 12, avenger: 12, careful: 12, newbie: 24, afk: 12, showoff: 14, fan: 8 }
            : zone === 'royale' ? { hunter: 26, avenger: 20, careful: 26, newbie: 12, showoff: 12, fan: 4 }
                : zone === 'duel' ? { hunter: 1 }
                    : hardcore ? { hunter: 30, avenger: 26, careful: 14, newbie: 4, afk: 2, showoff: 18, fan: 6 }
                        : { hunter: 18, avenger: 18, careful: 14, newbie: 16, afk: 6, showoff: 12, fan: 6 };
        if (fans >= 1) w.fan = 0;
        return botsWeighted(w);
    },

    _pickSkill(kind, hardcore) {
        const R = { newbie: [0.12, 0.35], afk: [0.25, 0.5], careful: [0.4, 0.62], avenger: [0.35, 0.65], hunter: [0.5, 0.75],
            showoff: [0.4, 0.7], fan: [0.3, 0.6], friend: [0.3, 0.6] }[kind] || [0.3, 0.6];
        const s = botsRand(R[0], R[1]);
        return hardcore ? botsClamp(0.82 + botsRand(-0.07, 0.08) - (kind === 'newbie' ? 0.12 : 0), 0.6, 0.95) : s;
    },

    // Аура: много 0–80, часть 100–700, немного 700–1000, редкие 1000–3000 (хардкор — выше).
    _pickAura(hardcore, kind) {
        if (kind === 'newbie' && !hardcore) return Math.floor(Math.pow(Math.random(), 2) * 60);
        const r = Math.random(), u = Math.random();
        const lo = hardcore ? 0.22 : 0.52, mid = hardcore ? 0.68 : 0.88, hi = hardcore ? 0.84 : 0.95;
        if (r < lo) return Math.floor(81 * Math.pow(u, 1.6));
        if (r < mid) return 100 + Math.floor(600 * Math.pow(u, 1.4));
        if (r < hi) return 700 + Math.floor(300 * u);
        return 1000 + Math.floor(2000 * Math.pow(u, 1.8));
    },

    _gloveFor(aura) {
        if (typeof GameGloves !== 'undefined' && typeof GameGloves.pickForBot === 'function') {
            try { return GameGloves.pickForBot(aura) || 'default'; } catch (e) { return 'default'; }
        }
        return 'default';
    },

    _setGlove(c, id, emit) {
        if (!id || c.glove === id) return;
        c.setGlove(id);
        if (emit) Game.emit('glove', { char: c, glove: id });
    },

    _gloveName(id) {
        const g = typeof GameGloves !== 'undefined' ? GameGloves.get(id) : null;
        return g ? g.name : id;
    },

    // Ник без повторов в сессии (и не как у игрока).
    _name(ru) {
        const pn = Game.player ? Game.player.name.toLowerCase() : '';
        for (let k = 0; k < 40; k++) {
            const n = ru ? this._ruName() : this._enName();
            const key = n.toLowerCase();
            if (n.length < 3 || n.length > 20 || this._names.has(key) || key === pn) continue;
            this._names.add(key);
            return n;
        }
        return this._claim((Lang.code === 'ru' ? 'Игрок' : 'Player') + (10000 + Math.floor(Math.random() * 89999)));
    },

    _claim(name) {
        let n = name;
        while (this._names.has(n.toLowerCase())) n = name + Math.floor(Math.random() * 100);
        this._names.add(n.toLowerCase());
        return n;
    },

    _enName() {
        const E = BOT_NAME_EN, P = botsPick, r = Math.random();
        if (r < 0.32) return P(E.adj) + P(E.noun) + (Math.random() < 0.8 ? botsDigits() : '');
        if (r < 0.44) return P(E.noun) + P(E.noun) + botsDigits();
        if (r < 0.54) {
            const w = Math.random() < 0.5 ? P(E.noun) : P(E.adj) + P(E.noun);
            return Math.random() < 0.7 ? 'xX_' + w + '_Xx' : 'Xx' + w + 'xX';
        }
        if (r < 0.66) return (P(E.noun) + '_' + P(['master', 'lover', 'king', 'boy', 'girl', 'gamer', 'fan', 'slayer', P(E.noun)])).toLowerCase() + botsDigits();
        if (r < 0.76) return P(E.first) + P(E.noun.concat(E.tag)) + (Math.random() < 0.6 ? botsDigits() : '');
        if (r < 0.83) return P(['iTz', 'itz_', 'TheReal', 'Im', 'Not']) + P(E.first.concat(E.noun));
        if (r < 0.9) return P(E.first) + '_' + (2008 + Math.floor(Math.random() * 10));
        if (r < 0.95) return 'I_Love_' + P(['Pizza', 'Cats', 'Dogs', 'Slaps', 'Aura', 'Tacos', 'Cookies', 'Pandas']);
        return P(E.adj).toLowerCase() + '_' + P(E.noun).toLowerCase() + (Math.random() < 0.5 ? botsDigits() : '');
    },

    _ruName() {
        const R = BOT_NAME_RU, T = BOT_NAME_TR, P = botsPick;
        // Русская версия — только кириллица; транслит — лишь как редкая примесь в английской.
        if (Lang.code === 'ru' || Math.random() < 0.62) {
            const q = Math.random();
            let n;
            if (q < 0.2) n = P(R.first) + '_' + (2008 + Math.floor(Math.random() * 10));
            else if (q < 0.33) n = P(R.first) + '_' + P(R.tag);
            else if (q < 0.43) n = P(R.first) + botsDigits();
            else if (q < 0.66) n = P(R.word) + (Math.random() < 0.3 ? botsDigits() : '');
            else if (q < 0.82) n = P(R.adj) + P(R.noun) + (Math.random() < 0.3 ? botsDigits() : '');
            else if (q < 0.88) n = 'Нагибатор' + P(['228', '777', '3000', '2000', '1337']);
            else n = P(R.first) + P(R.noun);
            return Math.random() < 0.12 ? n.toLowerCase() : n;
        }
        const q = Math.random();
        if (q < 0.35) return P(T.first) + '_' + P(T.tag);
        if (q < 0.6) return P(T.first) + botsDigits();
        if (q < 0.85) return P(T.word) + botsDigits();
        return P(T.first) + P(T.word);
    },

    // Внешность по архетипу: { colors, face, accessories } (конфликты и color — _fixLook).
    _look(aura, kind) {
        const C = BOT_C, P = botsPick, R = Math.random;
        /** @type {Record<string, number>} */
        const w = { rookie: 9, bacon: 12, girl: 10, bob: 7, ninja: 6, robot: 5, hoodie: 9, pastel: 7, emo: 5, sporty: 7,
            rich: aura >= 600 ? 9 : aura >= 300 ? 2 : 0, demon: aura >= 400 ? 6 : 2, angel: 3, gamer: 7, skater: 6, gent: 3, random: 14 };
        if (kind === 'newbie') { w.rookie += 14; w.bacon += 8; w.rich = 0; w.demon = 0; }
        if (aura >= 1000) { w.rich += 8; w.demon += 4; w.ninja += 3; }
        const arch = botsWeighted(w);
        // Вещи каталога гардероба по архетипу и ауре; без гардероба — цвета частей (ниже).
        if (typeof GameWardrobe !== 'undefined' && typeof GameWardrobe.botLook === 'function') {
            const cl = GameWardrobe.botLook(aura, arch, kind);
            if (cl) return cl;
        }
        const skin = P(BOT_SKINS);
        let head = skin, torso = C.blue, armL = skin, armR = skin, legL = C.navy, legR = C.navy, face = 'smile';
        /** @type {Array<{ id: string, color?: number }>} */
        const acc = [];
        const arms = (v) => { armL = armR = v; };
        const legs = (v) => { legL = legR = v; };
        switch (arch) {
            case 'bacon':
                head = P([0xffcc99, 0xeab892, 0xf2c8a2]); arms(head);
                torso = P([C.grey, C.black, C.blue, C.white, C.red, C.green]);
                legs(P([C.navy, C.black, C.darkGrey, C.blue]));
                acc.push({ id: 'hair_spiky', color: P([0x8a4b22, 0x5a3a22, 0x6b3a1e]) });
                face = P(['smile', 'happy', 'grin', 'smile']);
                break;
            case 'girl':
                torso = P([C.pink, C.hotPink, C.lavender, C.white, C.sky, C.mint, C.red]);
                if (R() < 0.45) arms(torso);
                legs(P([C.white, C.pink, C.sky, C.lavender, C.black, C.navy]));
                acc.push({ id: 'hair_long', color: P([0x1b1b1b, 0x2e1d12, 0x5a3a22, 0xe8c46a, 0xe8c46a, 0xc0562a, 0xff8fc7, 0x7b4bd8]) });
                if (R() < 0.3) acc.push({ id: 'cat_ears', color: P([C.pink, C.black, C.white]) });
                else if (R() < 0.2) acc.push({ id: 'sunglasses' });
                else if (R() < 0.15) acc.push({ id: P(['cap', 'beanie']), color: P([C.pink, C.white, C.black, C.lavender]) });
                face = P(['girl', 'girl', 'cute', 'wink', 'happy']);
                break;
            case 'bob':
                torso = P([C.white, C.yellow, C.sky, C.red, C.purple, C.mint, C.orange]);
                legs(P([C.navy, C.black, C.white, C.sky]));
                acc.push({ id: 'hair_bob', color: P(BOT_HAIRS) });
                if (R() < 0.35) acc.push({ id: P(['cap', 'beanie', 'tophat', 'crown']), color: P([C.red, C.black, C.white, C.blue, C.pink]) });
                if (R() < 0.25) acc.push({ id: 'headphones', color: P([C.white, C.black, C.pink, C.cyan]) });
                face = P(['girl', 'cute', 'smile', 'smirk', 'wink']);
                break;
            case 'ninja':
                torso = C.black; arms(C.black); legs(C.black);
                acc.push({ id: 'beanie', color: 0x141414 }, { id: 'sword_back' });
                face = P(['angry', 'cool', 'evil', 'smirk']);
                break;
            case 'robot':
                head = C.grey; arms(C.grey); torso = C.darkGrey; legs(C.darkGrey);
                if (R() < 0.5) acc.push({ id: 'headphones', color: P([C.cyan, C.red, C.lime]) });
                face = P(['shocked', 'derp', 'cool', 'silly']);
                break;
            case 'hoodie':
                torso = P([C.red, C.red, C.crimson]); arms(torso);
                legs(P([C.black, C.navy, C.darkGrey]));
                if (R() < 0.4) acc.push({ id: 'headphones', color: P([C.black, C.white]) });
                else if (R() < 0.35) acc.push({ id: 'cap', color: P([C.black, C.white, C.red]) });
                face = P(['smirk', 'cool', 'smile', 'grin']);
                break;
            case 'pastel':
                torso = P([C.pink, C.lavender, C.mint, C.sky]);
                legs(P([C.pink, C.lavender, C.mint, C.sky, C.white]));
                acc.push({ id: 'hair_bob', color: P([0xff8fc7, 0xc9b6ff, 0xffffff, 0xe8c46a, 0x9fe3ff]) });
                if (R() < 0.5) acc.push({ id: 'cat_ears', color: P([C.pink, C.white, C.lavender]) });
                face = P(['cute', 'happy', 'wink', 'girl']);
                break;
            case 'emo':
                torso = C.black; arms(R() < 0.5 ? C.black : skin); legs(P([C.black, C.darkGrey]));
                acc.push({ id: R() < 0.6 ? 'hair_bob' : 'hair_long', color: P([0x1b1b1b, 0x1b1b1b, 0x7b4bd8, 0x3d7bff]) });
                if (R() < 0.4) acc.push({ id: 'headphones', color: C.black });
                face = P(['sleepy', 'worried', 'smirk']);
                break;
            case 'sporty': {
                const team = P([C.red, C.blue, C.green, C.orange, C.yellow, C.cyan]);
                torso = team; legs(P([C.white, C.black]));
                acc.push({ id: 'cap', color: R() < 0.6 ? team : C.white });
                if (R() < 0.3) acc.push({ id: 'backpack', color: P([C.black, team]) });
                face = P(['grin', 'happy', 'smile']);
                break;
            }
            case 'rich':
                torso = P([C.gold, C.black, C.white]); legs(P([C.black, C.white]));
                acc.push({ id: 'crown' });
                if (R() < 0.6) acc.push({ id: 'sunglasses' });
                if (R() < 0.3) acc.push({ id: 'wings', color: C.white });
                face = P(['smirk', 'cool', 'grin']);
                break;
            case 'demon':
                torso = P([C.black, C.crimson]); legs(C.black);
                if (R() < 0.3) arms(C.black);
                acc.push({ id: 'horns' }, { id: 'wings', color: 0x1b1b1b });
                face = P(['evil', 'angry', 'smirk']);
                break;
            case 'angel':
                torso = C.white; legs(C.white);
                acc.push({ id: 'wings', color: 0xffffff }, { id: 'hair_bob', color: P([0xe8c46a, 0xffffff, 0xffe9a8]) });
                face = P(['happy', 'cute', 'smile']);
                break;
            case 'gamer':
                torso = P([C.black, C.navy, C.purple, C.darkGrey]); legs(P([C.black, C.navy]));
                if (R() < 0.5) { acc.push({ id: 'hair_spiky', color: P(BOT_HAIRS) }); if (R() < 0.4) acc.push({ id: 'sunglasses' }); }
                else acc.push({ id: 'hair_bob', color: P(BOT_HAIRS) }, { id: 'headphones', color: P([C.red, C.cyan, C.lime, C.purple]) });
                face = P(['cool', 'grin', 'smirk']);
                break;
            case 'skater':
                torso = P([C.orange, C.teal, C.purple, C.red, C.yellow]); legs(P([C.navy, C.black, C.sand]));
                acc.push({ id: 'beanie', color: P([C.red, C.black, C.yellow, C.teal]) }, { id: 'backpack', color: P([C.black, C.blue, C.orange]) });
                face = P(['smile', 'grin', 'silly']);
                break;
            case 'gent':
                torso = C.black; arms(C.black); legs(C.black);
                acc.push({ id: 'tophat', color: P([C.red, C.black, C.purple]) });
                if (R() < 0.4) acc.push({ id: 'sunglasses' });
                face = P(['smirk', 'cool']);
                break;
            default: {
                const pal = Object.values(C);
                torso = P(pal);
                legs(R() < 0.7 ? P(pal) : torso);
                if (R() < 0.3) { legL = P(pal); legR = P(pal); }
                if (R() < 0.4) arms(torso);
                const ids = Object.keys(BOT_ACC);
                const k = Math.floor(R() * 3.2);
                for (let i = 0; i < k; i++) acc.push({ id: P(ids), color: R() < 0.5 ? P(BOT_HAIRS) : P(pal) });
                face = P(Object.keys(Character.FACES));
            }
        }
        if (!Character.FACES[face]) face = 'smile';
        return this._fixLook({ colors: { head, torso, leftArm: armL, rightArm: armR, leftLeg: legL, rightLeg: legR }, face, accessories: acc });
    },

    // Аксессуары: один на слот, без конфликтов; color — только тем, у кого есть Tint.
    _fixLook(look) {
        /** @type {Array<{ id: string, color?: number }>} */
        const out = [];
        for (const a of look.accessories || []) {
            const info = BOT_ACC[a.id];
            if (!info) continue;
            if (out.some(x => x.id === a.id || BOT_ACC[x.id].slot === info.slot || info.conflicts.indexOf(x.id) >= 0 || BOT_ACC[x.id].conflicts.indexOf(a.id) >= 0)) continue;
            out.push(info.tint && a.color != null ? { id: a.id, color: a.color } : { id: a.id });
        }
        look.accessories = out;
        return look;
    },

    // --- Аватар бейджа: голова с лицом (PNG лица), волосы/шапка, плечи цвета торса ---------------

    _loadFaces() {
        if (typeof Image === 'undefined') return;
        for (const k in Character.FACES) {
            const img = new Image();
            img.onload = () => { this._avDirty = true; };
            img.src = Character.FACES[k];
            this._faces[k] = img;
        }
    },

    _refreshAvatars() {
        const ui = typeof GameUI !== 'undefined' ? GameUI : null;
        for (const b of this.bots.values()) {
            const c = b.c;
            const av = this._avatar(c.look);
            if (av && av !== c.avatar) { c.avatar = av; if (ui && typeof ui.refreshBadge === 'function') ui.refreshBadge(c); }
        }
    },

    _avatar(look) {
        try {
            if (typeof document === 'undefined' || !look) return null;
            if (Character.isCosLook(look)) return Character.avatarFor(look);   // вещи каталога
            const col = look.colors || {};
            /** @type {Array<{ id: string, color?: number }>} */
            const acc = look.accessories || [];
            const img = this._faces[look.face];
            const ready = !!(img && img.complete && img.naturalWidth > 0);
            const key = [col.head, col.torso, look.face, ready ? 1 : 0, acc.map(a => a.id + (a.color != null ? ':' + a.color : '')).join(',')].join('|');
            if (this._avCache[key]) return this._avCache[key];
            const S = 64, cv = document.createElement('canvas');
            cv.width = cv.height = S;
            const ctx = cv.getContext('2d');
            if (!ctx) return null;
            const rr = (x, y, w, h, r) => {
                ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
                ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
            };
            const poly = (pts) => { ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]); ctx.closePath(); ctx.fill(); };
            const has = (id) => acc.find(a => a.id === id);
            const torso = col.torso != null ? col.torso : 0x0d69ac;
            const hair = acc.find(a => /^hair_/.test(a.id));
            const hairC = hair ? botsHex(hair.color != null ? hair.color : 0x3b2616) : '';
            ctx.save();
            ctx.beginPath(); ctx.arc(32, 32, 32, 0, Math.PI * 2); ctx.clip();
            ctx.fillStyle = botsHex(botsMix(torso, 0xffffff, 0.55)); ctx.fillRect(0, 0, S, S);
            ctx.fillStyle = botsHex(torso); rr(6, 50, 52, 24, 8); ctx.fill();
            if (hair && hair.id === 'hair_long') { ctx.fillStyle = hairC; rr(9, 12, 46, 44, 9); ctx.fill(); }
            ctx.fillStyle = botsHex(col.head != null ? col.head : BOT_SKINS[1]); rr(14, 13, 36, 36, 9); ctx.fill();
            if (ready) ctx.drawImage(img, 14, 13, 36, 36);
            else {
                ctx.fillStyle = '#151515'; ctx.fillRect(24, 25, 4, 7); ctx.fillRect(36, 25, 4, 7);
                ctx.lineWidth = 3; ctx.strokeStyle = '#151515'; ctx.beginPath(); ctx.arc(32, 33, 9, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke();
            }
            if (hair) {
                ctx.fillStyle = hairC;
                if (hair.id === 'hair_spiky') {
                    const pts = [12, 22];
                    for (let i = 0; i <= 6; i++) pts.push(12 + i * 6.7, i % 2 ? 4 : 11);
                    pts.push(52, 22, 49, 18, 15, 18);
                    poly(pts);
                } else {
                    rr(11, 9, 42, 12, 6); ctx.fill();
                    const h = hair.id === 'hair_long' ? 34 : 20;
                    ctx.fillRect(11, 14, 5, h); ctx.fillRect(48, 14, 5, h);
                }
            }
            const hat = acc.find(a => BOT_ACC[a.id] && BOT_ACC[a.id].slot === 'hat');
            if (hat) {
                const hc = botsHex(hat.color != null ? hat.color : 0xc4281c);
                if (hat.id === 'cap') { ctx.fillStyle = hc; rr(12, 6, 40, 13, 7); ctx.fill(); ctx.fillStyle = botsHex(botsMix(hat.color != null ? hat.color : 0xc4281c, 0, 0.3)); rr(26, 15, 30, 5, 2); ctx.fill(); }
                else if (hat.id === 'beanie') { ctx.fillStyle = hc; ctx.beginPath(); ctx.arc(32, 21, 20, Math.PI, 0); ctx.fill(); ctx.fillRect(12, 16, 40, 6); ctx.fillStyle = '#f2f2f2'; ctx.beginPath(); ctx.arc(32, 2, 4, 0, Math.PI * 2); ctx.fill(); }
                else if (hat.id === 'tophat') { ctx.fillStyle = '#151515'; rr(18, -2, 28, 18, 2); ctx.fill(); rr(10, 14, 44, 5, 2); ctx.fill(); ctx.fillStyle = hc; ctx.fillRect(18, 10, 28, 4); }
                else if (hat.id === 'crown') { ctx.fillStyle = '#f2c230'; poly([14, 18, 14, 5, 21, 11, 27, 1, 32, 9, 37, 1, 43, 11, 50, 5, 50, 18]); ctx.fillStyle = '#d02a3a'; ctx.beginPath(); ctx.arc(32, 14, 2.5, 0, Math.PI * 2); ctx.fill(); }
                else if (hat.id === 'horns') { ctx.fillStyle = '#c8202a'; poly([16, 16, 11, 1, 23, 12]); poly([48, 16, 53, 1, 41, 12]); }
                else if (hat.id === 'cat_ears') { ctx.fillStyle = hc; poly([14, 19, 16, 2, 27, 14]); poly([50, 19, 48, 2, 37, 14]); ctx.fillStyle = '#ffb3d1'; poly([17, 16, 18, 7, 24, 14]); poly([47, 16, 46, 7, 40, 14]); }
            }
            const hp = has('headphones');
            if (hp) {
                ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(32, 30, 21, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
                ctx.fillStyle = botsHex(hp.color != null ? hp.color : 0x222222); rr(7, 24, 9, 15, 3); ctx.fill(); rr(48, 24, 9, 15, 3); ctx.fill();
            }
            if (has('sunglasses')) { ctx.fillStyle = '#111'; rr(17, 23, 13, 8, 3); ctx.fill(); rr(34, 23, 13, 8, 3); ctx.fill(); ctx.fillRect(29, 25, 6, 2); }
            ctx.restore();
            return (this._avCache[key] = cv.toDataURL('image/png'));
        } catch (e) { return null; }
    },

    // --- ИИ: решения -----------------------------------------------------------------------------

    _reaction(b) {
        const k = Math.random() * 0.6 + (1 - b.skill) * 0.4;
        return BOT_REACTION_MIN + (BOT_REACTION_MAX - BOT_REACTION_MIN) * k;
    },

    _think(b) {
        const c = b.c, now = Game.time;
        b.thinkAt = now + botsRand(BOT_THINK_MIN, BOT_THINK_MAX) * (1.2 - 0.4 * b.skill);
        // «Застрял»: хочет идти, но почти не сдвинулся.
        const el = now - b.lastT;
        if (el > 0.05) {
            const moved = Math.hypot(c.x - b.lastX, c.y - b.lastY);
            const wants = Math.hypot(c.moveX, c.moveY) > 0.45 && (c.state === 'run' || c.state === 'idle') && c.onGround;
            if (wants && moved < 70 * el) b.stuckT += el; else b.stuckT = 0;
            b.lastX = c.x; b.lastY = c.y; b.lastT = now;
            if (b.stuckT > BOT_STUCK) this._unstuck(b);
        }
        this._nearCols(b);
        if (!c.canAct() && c.state !== 'slap') return;
        if (Game.pvp(b.zone)) this._thinkFight(b); else this._thinkLobby(b);
    },

    // Препятствия рядом (для обхода в _steer) — раз в решение.
    _nearCols(b) {
        const c = b.c, out = b.cols;
        out.length = 0;
        for (const k of GameWorld.colliders) {
            const dx = k.x - c.x, dy = k.y - c.y, R = 700 + k.r;
            if (dx * dx + dy * dy < R * R) out.push(k);
        }
    },

    _unstuck(b) {
        const c = b.c;
        b.stuckT = 0;
        this.stats.stuck++;
        const a = Math.atan2(c.moveY, c.moveX) + (Math.random() < 0.5 ? 1 : -1) * botsRand(1.2, 2.0);
        b.ux = Math.cos(a); b.uy = Math.sin(a);
        b.unstuckUntil = Game.time + botsRand(0.5, 0.9);
        if (Math.random() < 0.5) c.jump();
        if (b.act === 'walk' || b.act === 'wander') b.act = 'idle';
    },

    _jumpGap(b) {
        const lobby = !Game.pvp(b.zone);
        if (b.kind === 'newbie') return lobby ? botsRand(2, 6) : botsRand(3, 9);
        if (b.kind === 'showoff') return botsRand(5, 14);
        return lobby ? botsRand(8, 25) : botsRand(12, 35);
    },

    // Бой (арена, битва, дуэль).
    _thinkFight(b) {
        const c = b.c, now = Game.time, p = Game.player;
        if (b.act === 'afk') {
            if (now < b.afkUntil) return;
            this._afkBack(b);
        }
        if (b.act === 'emote') { if (now < b.waitUntil) return; b.act = 'idle'; }
        if (b.afkAt && now >= b.afkAt && !this._enemyNear(b, 350)) { this._goAfk(b, 0.15); return; }
        if (b.grudge && (now > b.grudgeUntil || !this._valid(b, b.grudge, true))) b.grudge = null;
        if (b.friend && (b.friend.disposed || !this.bots.has(b.friend))) b.friend = null;
        // Сессия кончилась — «вышел из игры» (не в разгар боя с игроком).
        if (b.respawn && Game.realTime > b.sessionUntil && b.target !== p) { this._quit(b); return; }
        const t = this._chooseTarget(b);
        if (t !== b.target) this._engage(b, t);
        const ed = GameWorld.edgeDist(c.x, c.y, b.zone);
        if (t) b.act = 'fight';
        else if (ed < b.edgeM * 1.2 && b.act !== 'wander') this._wander(b, true);
        else if (b.act !== 'wander' || Math.hypot(b.gx - c.x, b.gy - c.y) < 120 || Math.random() < 0.08) this._wander(b, false);
        const dashOk = c.canAct() && c.onGround && c.dashCooldownLeft() <= 0;
        const dashLen = GameCfg.dashSpeed * GameCfg.dashTime;
        if (dashOk && ed < 170 && Math.random() < 0.25 + 0.6 * b.skill) {
            // Рывок от края.
            const g = this._inward(c.x, c.y, b.zone);
            c.dash(g.x, g.y);
        } else if (dashOk && t && now >= b.reactAt) {
            const R = GameCombat.range(c), d = Math.hypot(t.x - c.x, t.y - c.y);
            if (d > R * 2.2 && d < R * 4.6 && Math.random() < b.skill * 0.45) {
                // Рывок на сближение (с упреждением), если не к краю.
                const lx = t.x + t.vx * 0.3 - c.x, ly = t.y + t.vy * 0.3 - c.y, l = Math.hypot(lx, ly) || 1;
                if (GameWorld.edgeDist(c.x + lx / l * dashLen, c.y + ly / l * dashLen, b.zone) > 240) c.dash(lx, ly);
            } else if (b.skill > 0.55) {
                // Уклон от замаха бота (шлепок игрока гарантирован — от него не уворачиваются).
                for (const o of Game.chars) {
                    if (!o.isBot || o === c || !o.slap || o.slap.target !== c || o.slap.hitDone) continue;
                    if (Math.hypot(o.x - c.x, o.y - c.y) > GameCombat.range(o) * 1.3 || Math.random() > 0.18) break;
                    const g = this._inward(c.x, c.y, b.zone);
                    const ax = o.x - c.x, ay = o.y - c.y, s = (ax * -g.y + ay * g.x) > 0 ? -1 : 1;
                    const px = -ay * s, py = ax * s, pl = Math.hypot(px, py) || 1;
                    c.dash(px / pl + g.x * 0.5, py / pl + g.y * 0.5);
                    break;
                }
            }
        }
        if (now >= b.jumpAt) {
            b.jumpAt = now + this._jumpGap(b);
            if (c.canAct() && c.onGround && (ed > 320 || b.kind === 'newbie')) c.jump();
        }
        // Новичок иногда «зевает» край.
        if (b.kind === 'newbie' && ed < 450 && Math.random() < BOT_LAPSE) b.lapseUntil = now + botsRand(0.8, 1.6);
        if (Math.random() < 0.12) b.strafe = -b.strafe;
        if (Math.random() < 0.15) b.orbit = botsRand(0.55, 0.85);
    },

    // Цель: ближе — лучше; охотник — слабых и у края, мститель — обидчика, осторожный — у центра,
    // фанат — игрока; на игрока одновременно не больше BOT_MAX_ON_PLAYER ботов.
    _chooseTarget(b) {
        const c = b.c, p = Game.player, z = GameWorld.zones[b.zone];
        const see = b.zone === 'duel' ? 1e9 : b.kind === 'newbie' ? BOT_SEE * 0.6 : BOT_SEE;
        const onP = this._onPlayer - (b.target === p && b.act === 'fight' ? 1 : 0);
        const fr = b.friend && !b.friend.disposed && b.friend.state !== 'dead' ? b.friend : null;
        const farm = b.zone === 'arena' && typeof GameFarm !== 'undefined' && GameFarm.on ? GameFarm : null;
        let best = null, bs = Infinity;
        for (const o of Game.chars) {
            if (o === c || !this._valid(b, o, false)) continue;
            if (o.isPlayer && onP >= BOT_MAX_ON_PLAYER) continue;
            const d = Math.hypot(o.x - c.x, o.y - c.y);
            if (d > see) continue;
            // Фарм: бой — за зону. Цели вне зон бот замечает только вплотную (охотник — чуть дальше).
            if (farm && d > (farm.zoneAt(o.x, o.y, 60) ? (b.kind === 'hunter' ? 1800 : 520) : (b.kind === 'hunter' ? 330 : 230))) continue;
            let s = d + 150;
            if (farm && farm.inZone(o)) s *= 0.55;   // тот, кто фармит, — приоритетная цель: его выбивают из зоны
            if (!o.canBeSlapped()) s *= 1.6;
            if (o === b.target) s *= 0.7;
            if (o === b.grudge) s *= b.kind === 'avenger' ? 0.2 : 0.4;
            if (o.isPlayer) s *= b.kind === 'fan' ? 0.35 : b.hardcore ? 0.85 : 1;
            if (b.kind === 'hunter') {
                const ed = GameWorld.edgeDist(o.x, o.y, b.zone);
                s *= (0.55 + 0.45 * Math.min(1, o.aura / 600)) * (0.45 + 0.55 * botsClamp(ed / 900, 0, 1));
            } else if (b.kind === 'careful' && z) {
                s += Math.max(0, Math.hypot(o.x - z.x, o.y - z.y) - z.r * 0.45) * 1.2;
            }
            if (fr && Math.hypot(o.x - fr.x, o.y - fr.y) < 500) s *= 0.8;
            if (s < bs) { bs = s; best = o; }
        }
        // Новичок часто просто бродит и не замечает новых целей.
        if (best && b.kind === 'newbie' && best !== b.target && Math.random() < 0.35) return this._valid(b, b.target, false) ? b.target : null;
        return best;
    },

    // Цель допустима: жива, в зоне, видна (не «Призрак»), не своя команда, не падает.
    _valid(b, o, loose) {
        const c = b.c;
        if (!o || o === c || o.disposed || o.state === 'dead' || o.hidden || o.zone !== b.zone) return false;
        if (o.invisible) return false;
        if (c.team && c.team === o.team) return false;
        if (o.h < -200 || o.state === 'falling') return false;
        if (!loose && Game.time < o.shieldUntil - 0.3) return false;
        return true;
    },

    // Новая цель: задержка реакции и «манера» боя на это сближение.
    _engage(b, t) {
        const p = Game.player;
        if (b.target && b.target === p && b.act === 'fight') this._onPlayer--;
        b.target = t;
        if (!t) return;
        if (t === p) this._onPlayer++;
        const s = b.skill;
        b.reactAt = Game.time + this._reaction(b);
        b.flank = Math.random() < (b.kind === 'hunter' ? 0.45 + 0.5 * s : 0.35 * s);
        b.faceLock = s > 0.45 && Math.random() < s * 0.8;
        b.spacing = s >= 0.7 && Math.random() < s - 0.25;
        b.strafe = Math.random() < 0.5 ? 1 : -1;
        b.strafeK = 0.15 + 0.25 + 0.6 * s * Math.random();
        b.orbit = botsRand(0.55, 0.85);
        b.reachK = botsRand(0.8, 1.05);
        if (t === b.grudge && Math.random() < 0.2) this._say(b, 'revenge', { name: t.name });
        else if (b.kind === 'fan' && t.isPlayer && Math.random() < 0.25) this._say(b, 'fan');
    },

    // Без цели: бродить (осторожный и в битве — у центра, часто — ближе к игроку, друг — к другу).
    _wander(b, central) {
        const p = Game.player, z = GameWorld.zones[b.zone];
        let pt;
        // Фарм: почти все идут в ближайшую зону ауры и топчутся в ней (новичок и «осторожный» — всегда).
        const farm = b.zone === 'arena' && typeof GameFarm !== 'undefined' && GameFarm.on ? GameFarm : null;
        const fz = farm ? farm.nearestZone(b.c.x, b.c.y) : null;
        if (fz && b.kind !== 'afk' && Math.random() < (b.kind === 'hunter' ? 0.55 : 0.92)) {
            const q = farm.pointIn(fz, 0.65);
            b.act = 'wander'; b.gx = q.x; b.gy = q.y; b.goalR = 90; b.thr = botsRand(0.8, 1);
            return;
        }
        if (central || b.kind === 'careful' || b.zone === 'royale' || b.zone === 'duel') pt = this._randomPoint(b.zone, z ? { x: z.x, y: z.y } : null, z ? z.r * 0.4 : 600, 300);
        else if (b.friend && !b.friend.disposed && b.friend.zone === b.zone && b.friend.state !== 'dead') pt = this._randomPoint(b.zone, b.friend, 300, 300);
        else if (p && p.zone === b.zone && p.state !== 'dead' && Math.random() < (b.kind === 'fan' ? 0.9 : 0.45)) pt = this._randomPoint(b.zone, p, 900, 300);
        else pt = this._randomPoint(b.zone, null, 0, 350);
        if (!pt) return;
        b.act = 'wander'; b.gx = pt.x; b.gy = pt.y; b.goalR = 120; b.thr = botsRand(0.8, 1);
    },

    _enemyNear(b, r) {
        const c = b.c;
        for (const o of Game.chars) if (this._valid(b, o, true) && Math.hypot(o.x - c.x, o.y - c.y) < r) return true;
        return false;
    },

    _goAfk(b, sitChance) {
        const c = b.c, now = Game.time, dur = botsRand(BOT_AFK_MIN, BOT_AFK_MAX);
        if (Math.random() < 0.15) this._say(b, 'afkGo');
        b.act = 'afk'; b.afkUntil = now + dur; b.target = null; b.mx = b.my = 0;
        b.afkAt = b.kind === 'afk' ? now + dur + botsRand(40, 120) : 0;
        c.setMove(0, 0);
        if (Math.random() < sitChance) c.emote('sit', dur);
    },

    _afkBack(b) {
        b.act = 'idle';
        b.reactAt = Game.time + this._reaction(b) * 2;
        if (b.c.emoteName === 'sit') b.c.emoteName = null;
        if (Math.random() < 0.35) this._say(b, 'afkBack');
    },

    // Отсчёт раунда: стоят, иногда подпрыгивают и машут; в дуэли смотрят на соперника.
    _frozenIdle(b) {
        const c = b.c, p = Game.player;
        if (!c.canAct()) return;
        if (b.zone === 'duel' && p && p.zone === 'duel') c.faceTo(p.x, p.y, 1.5);
        const r = Math.random();
        if (r < 0.1) c.jump();
        else if (r < 0.16) c.emote('wave', 1.2);
    },

    // Лобби (без шлепков).
    _thinkLobby(b) {
        const c = b.c, now = Game.time, p = Game.player;
        if (b.act === 'afk') {
            if (now < b.afkUntil) return;
            this._afkBack(b);
        }
        if (b.act === 'emote') { if (now < b.waitUntil) return; b.act = 'idle'; }
        b.target = null;
        if (b.afkAt && now >= b.afkAt && b.act !== 'portal') { this._goAfk(b, 0.55); return; }
        if (now >= b.jumpAt) {
            b.jumpAt = now + this._jumpGap(b);
            if (c.onGround && c.canAct() && GameWorld.edgeDist(c.x, c.y, b.zone) > 300) c.jump();
        }
        // Пара друзей: ведомый ходит за ведущим (и идёт с ним в тот же портал).
        const fr = b.friend && !b.friend.disposed && b.friend.zone === b.zone && b.friend.state !== 'dead' ? b.friend : null;
        const lead = fr && !b.leader ? this.bots.get(fr) : null;
        if (lead) {
            if (lead.act === 'portal' && lead.portal) { if (b.act !== 'portal') this._goPortal(b, lead.portalMode); return; }
            if (b.act !== 'portal') { b.act = 'follow'; b.follow = fr; }
            if (Math.random() < 0.02) this._say(b, 'friend', { friend: fr.name });
            return;
        }
        // Фанат ходит за игроком и машет ему.
        if (b.kind === 'fan' && p && Game.started && p.zone === b.zone && p.state !== 'dead' && b.act !== 'portal') {
            if (b.act !== 'follow' && Math.random() < 0.6) {
                b.act = 'follow'; b.follow = p;
                if (Math.random() < 0.25) this._say(b, 'fan');
            }
            if (b.act === 'follow') {
                if (Math.hypot(p.x - c.x, p.y - c.y) < 450 && p.speed < 40 && Math.random() < 0.1) this._emote(b, Math.random() < 0.6 ? 'wave' : 'jump', 1.8, p);
                else if (Math.random() < 0.05) b.act = 'idle';
                return;
            }
        }
        if (b.act === 'follow') { b.act = 'idle'; b.follow = null; }
        if (b.act === 'walk' || b.act === 'ped' || b.act === 'board' || b.act === 'portal') return;
        if (now < b.waitUntil) {
            // Стоит: осматривается («крутит камеру»), иногда машет игроку рядом.
            if (Math.random() < 0.25) { const a = Math.random() * Math.PI * 2; c.faceTo(c.x + Math.cos(a) * 300, c.y + Math.sin(a) * 300, botsRand(0.5, 1.4)); }
            if (p && Game.started && p.zone === b.zone && Math.random() < 0.04 && Math.hypot(p.x - c.x, p.y - c.y) < 500) this._emote(b, 'wave', 1.6, p);
            return;
        }
        if (Game.realTime > b.lobbyUntil && b.respawn) { this._goPortal(b, null); return; }
        /** @type {Record<string, number>} */
        const w = { walk: 35, ped: 26, board: 7, emote: b.kind === 'showoff' ? 22 : 7, jump: b.kind === 'newbie' ? 18 : 4, afk: 2, chat: 6 };
        switch (botsWeighted(w)) {
            case 'walk': this._goWalk(b); break;
            case 'ped': this._goPedestal(b); break;
            case 'board': this._goBoard(b); break;
            case 'emote': this._emote(b, botsPick(['dance', 'wave', 'cheer', 'laugh', 'point', 'jump']), botsRand(1.5, 3.5), null); break;
            case 'jump': if (c.onGround) c.jump(); b.waitUntil = now + botsRand(0.5, 1.5); break;
            case 'afk': this._goAfk(b, 0.6); break;
            default: this._say(b, 'lobby'); b.waitUntil = now + botsRand(1, 3);
        }
    },

    // Эмоция на месте (look — повернуться к персонажу).
    _emote(b, name, dur, look) {
        const c = b.c;
        if (!c.canAct()) return;
        b.act = 'emote'; b.waitUntil = Game.time + dur; b.mx = b.my = 0;
        c.setMove(0, 0);
        c.emote(name, dur);
        if (look) c.faceTo(look.x, look.y, Math.min(dur, 2));
    },

    _goWalk(b) {
        const list = GameWorld.markers('lobby-walk');
        let x = 0, y = 0, ok = false;
        for (let k = 0; k < 8 && !ok; k++) {
            if (list.length && Math.random() < 0.8) { const m = botsPick(list); x = +m.x + botsRand(-160, 160); y = +m.y + botsRand(-160, 160); }
            else { const pt = this._randomPoint(b.zone, null, 0, 350); if (!pt) break; x = pt.x; y = pt.y; }
            ok = GameWorld.edgeDist(x, y, b.zone) > 250 && !this._inCollider(x, y) && !this._nearPortal(x, y);
        }
        if (!ok) { b.waitUntil = Game.time + 1; return; }
        b.act = 'walk'; b.gx = x; b.gy = y; b.goalR = 90; b.thr = Math.random() < 0.25 ? botsRand(0.6, 0.85) : 1;
    },

    // К пьедесталу: чаще — к перчатке своего уровня ауры (взять или «облизнуться»).
    _goPedestal(b) {
        const c = b.c;
        const gp = typeof GameGloves !== 'undefined' && GameGloves.pedestals && GameGloves.pedestals.length ? GameGloves.pedestals : null;
        const list = gp ? gp.map(pd => ({ x: pd.x, y: pd.y, id: pd.glove.id, need: pd.glove.ad ? pd.glove.botAura : pd.glove.aura }))
            : GameWorld.markers('glove').map(m => ({ x: +m.x, y: +m.y, id: /** @type {string | null} */ (null), need: 0 }));
        if (!list.length) { this._goWalk(b); return; }
        let ped = botsPick(list);
        if (gp && Math.random() < 0.55) {
            const ok = list.filter(x => x.need <= c.aura), next = list.filter(x => x.need > c.aura).sort((a, b2) => a.need - b2.need);
            if (Math.random() < 0.6 && ok.length) ped = ok[ok.length - 1 - Math.floor(Math.random() * Math.min(3, ok.length))];
            else if (next.length) ped = next[0];
        }
        const z = GameWorld.zones[b.zone];
        const sy = z && z.y < ped.y ? -1 : 1;
        b.ped = ped;
        b.act = 'ped'; b.gx = ped.x + botsRand(-35, 35); b.gy = ped.y + sy * botsRand(150, 190); b.goalR = 55; b.thr = 1;
    },

    // К доске рекордов (встать перед экраном).
    _goBoard(b) {
        const rec = GameWorld.objectsOf('leaderboard')[0];
        if (!rec || !rec.def) { this._goWalk(b); return; }
        const d = rec.def, rot = Array.isArray(d.rot) ? d.rot : [0, Number(d.rot) || 0, 0];
        const h = (Number(rot[1]) || 0) * Math.PI / 180, dist = botsRand(300, 420), side = botsRand(-150, 150);
        const x = (+d.x || 0) + Math.cos(h) * dist - Math.sin(h) * side, y = (+d.y || 0) + Math.sin(h) * dist + Math.cos(h) * side;
        if (GameWorld.edgeDist(x, y, b.zone) < 200) { this._goWalk(b); return; }
        b.ped = { x: +d.x || 0, y: +d.y || 0, id: null, need: 0 };
        b.act = 'board'; b.gx = x; b.gy = y; b.goalR = 70; b.thr = 1;
    },

    // В портал: подойти к арке спереди, войти в центр. На арену — чаще (почти всегда, если игрок там и ботов мало).
    _goPortal(b, mode) {
        const ps = GameWorld.portals;
        if (!ps.length) { b.lobbyUntil = Game.realTime + 60; return; }
        let m = mode;
        if (!m) {
            const cur = typeof GameModes !== 'undefined' ? GameModes.current : Game.mode;
            if (Game.zone === 'arena' && this._needs('arena') && Math.random() < 0.8) m = cur === 'hardcore' ? 'hardcore' : 'arena';
            else m = botsWeighted({ arena: 55, royale: 15, hardcore: 18, duel: 12 });
        }
        const portal = ps.find(x => x.mode === m) || botsPick(ps);
        // Лицевая сторона — по повороту арки (объект portal у маркера), иначе — к центру лобби.
        let fx = 0, fy = 0;
        for (const rec of GameWorld.objectsOf('portal')) {
            const d = rec.def;
            if (!d || Math.hypot((+d.x || 0) - portal.x, (+d.y || 0) - portal.y) > 250) continue;
            const rot = Array.isArray(d.rot) ? d.rot : [0, Number(d.rot) || 0, 0], h = (Number(rot[1]) || 0) * Math.PI / 180;
            fx = Math.cos(h); fy = Math.sin(h);
            break;
        }
        const z = GameWorld.zones[b.zone];
        if (z && (fx * (z.x - portal.x) + fy * (z.y - portal.y)) < 0) { fx = -fx; fy = -fy; }
        if (!fx && !fy && z) { const dx = z.x - portal.x, dy = z.y - portal.y, l = Math.hypot(dx, dy) || 1; fx = dx / l; fy = dy / l; }
        b.portal = portal; b.portalMode = portal.mode; b.portalStage = 0;
        b.act = 'portal'; b.gx = portal.x + fx * 260 + botsRand(-30, 30); b.gy = portal.y + fy * 260 + botsRand(-30, 30); b.goalR = 80; b.thr = 1;
        if (Math.random() < 0.25) this._say(b, { arena: 'goArena', royale: 'goRoyale', hardcore: 'goHardcore', duel: 'goDuel' }[portal.mode] || 'goArena');
    },

    // Вошёл в портал: на арену (если игрок там, режим совпадает и ботов не хватает) — иначе «ушёл в другой режим».
    _enterPortal(b) {
        const c = b.c, mode = b.portalMode;
        this.stats.portals++;
        const cur = typeof GameModes !== 'undefined' ? GameModes.current : Game.mode;
        if ((mode === 'arena' || mode === 'hardcore') && Game.zone === 'arena' && cur === mode && this._needs('arena')) {
            const sp = this._spawnPoint('arena');
            if (sp) {
                b.zone = 'arena'; c.zone = 'arena';
                b.hardcore = mode === 'hardcore';
                b.respawn = true;
                b.sessionUntil = Game.realTime + botsRand(BOT_SESSION_MIN, BOT_SESSION_MAX);
                const f = b.friend ? this.bots.get(b.friend) : null;
                if (f && !(f.act === 'portal' && f.portalMode === mode) && f.zone !== 'arena') {
                    if (f.friend === c) { f.friend = null; f.leader = true; }
                    b.friend = null;
                }
                c.respawn(sp.x, sp.y, sp.heading);
                if (Math.random() < 0.3) this._later(botsRand(1.5, 3.5), () => this._say(b, 'arenaJoin'));
                return;
            }
        }
        this._remove(b, false);
    },

    // Дошёл до точки цели.
    _arrive(b) {
        const c = b.c, now = Game.time;
        switch (b.act) {
            case 'portal':
                if (b.portalStage === 0 && b.portal) {
                    b.portalStage = 1; b.gx = b.portal.x; b.gy = b.portal.y; b.goalR = Math.max(30, b.portal.r * 0.45);
                    return;
                }
                this._enterPortal(b);
                return;
            case 'ped': {
                const ped = b.ped;
                b.act = 'idle'; b.waitUntil = now + botsRand(2, 4.5);
                if (ped) {
                    c.faceTo(ped.x, ped.y, 4);
                    this._later(botsRand(0.9, 2.2), () => this._tryGlove(b, ped));
                }
                return;
            }
            case 'board':
                b.act = 'idle'; b.waitUntil = now + botsRand(2, 5);
                if (b.ped) c.faceTo(b.ped.x, b.ped.y, 4);
                if (Math.random() < 0.3) this._later(botsRand(0.8, 2), () => this._say(b, 'board'));
                return;
            case 'wander':
                b.act = 'idle'; b.waitUntil = now + botsRand(0.2, 1.2);
                b.thinkAt = Math.min(b.thinkAt, now + 0.3);
                return;
            default:
                b.act = 'idle'; b.waitUntil = now + botsRand(0.8, 4);
        }
    },

    // «Примерить» перчатку у пьедестала: хватает ауры — иногда надевает, нет — вздыхает в чат.
    _tryGlove(b, ped) {
        const c = b.c;
        if (c.disposed || c.state === 'dead' || c.zone !== 'lobby' || !ped.id || !this.bots.has(c)) return;
        if (c.aura >= ped.need) {
            if (c.glove !== ped.id && Math.random() < 0.55) {
                this._setGlove(c, ped.id, true);
                if (Math.random() < 0.35) this._say(b, 'gloveTry', { glove: this._gloveName(ped.id) });
                else if (Math.random() < 0.3) this._emote(b, 'cheer', 1.2, null);
            }
        } else if (Math.random() < 0.3) this._say(b, 'gloveWant', { glove: this._gloveName(ped.id), n: ped.need - c.aura });
    },

    // Показуха после KO: танец / смех / «показывает пальцем» в сторону упавшего.
    _brag(b, v) {
        const c = b.c;
        if (c.disposed || !this.bots.has(c) || !c.canAct() || this.frozen[b.zone]) return;
        if (b.kind !== 'showoff' && this._enemyNear(b, 450)) return;
        b.target = null;
        this._emote(b, botsPick(['dance', 'dance', 'laugh', 'point', 'cheer', 'wave']), botsRand(1.6, 2.8), v);
    },

    // --- ИИ: движение каждый кадр ---------------------------------------------------------------

    _steer(b, dt) {
        const c = b.c, now = Game.time, st = c.state;
        if (st === 'ragdoll' || st === 'down' || st === 'getup') {
            b.recover = true;
            if (c.moveX || c.moveY) c.setMove(0, 0);
            b.mx = b.my = 0;
            return;
        }
        if (st === 'dash') return;
        if (st === 'falling') { const g = this._inward(c.x, c.y, b.zone); c.setMove(g.x, g.y); return; }
        if (b.recover) {
            // Встал: «пришёл в себя» с задержкой, скоро решение (уйти от края).
            b.recover = false;
            b.reactAt = Math.max(b.reactAt, now + this._reaction(b));
            b.slapAt = Math.max(b.slapAt, b.reactAt);
            b.thinkAt = Math.min(b.thinkAt, now + 0.12);
        }
        let dx = 0, dy = 0, thr = 0;
        /** @type {Character | null} */
        let face = null;
        b.goalD = Infinity;
        if (now < b.unstuckUntil) { dx = b.ux; dy = b.uy; thr = 1; }
        else if (b.act === 'fight') {
            const t = b.target;
            if (!this._valid(b, t, true)) {
                b.target = null; b.act = 'idle';
                b.thinkAt = Math.min(b.thinkAt, now + this._reaction(b));
            } else if (now < b.reactAt) {
                // Ещё не среагировал — движется как раньше.
                dx = b.mx; dy = b.my; thr = Math.hypot(dx, dy) > 0.05 ? 0.85 : 0;
            } else {
                const R = GameCombat.range(c), lead = 0.12 + 0.25 * b.skill;
                const tx = t.x + t.vx * lead, ty = t.y + t.vy * lead;
                const vx = tx - c.x, vy = ty - c.y, d = Math.hypot(vx, vy) || 1;
                const ux = vx / d, uy = vy / d;
                let ox = 0, oy = 0;
                if (b.flank) { const o = this._outward(t.x, t.y, b.zone); ox = o.x; oy = o.y; }
                if (d > R * 1.8) {
                    // Сближение (охотник — к точке между целью и центром острова).
                    dx = tx - ox * R * 0.7 - c.x; dy = ty - oy * R * 0.7 - c.y; thr = 1;
                } else {
                    // Вблизи: кружит/стрейфит на своей дистанции; сильный выжидает перезарядку цели.
                    let want = R * b.orbit;
                    if (b.spacing && !t.slap && now >= t.nextSlapAt - 0.05 && t.canAct()) want = Math.max(want, GameCombat.range(t) * 1.35);
                    const radial = botsClamp((d - want) / (R * 0.45), -1, 1);
                    const tang = (1 - Math.abs(radial)) * b.strafeK * b.strafe;
                    dx = ux * radial - uy * tang; dy = uy * radial + ux * tang;
                    if (b.flank) {
                        const fx = t.x - ox * want - c.x, fy = t.y - oy * want - c.y, fl = Math.hypot(fx, fy);
                        if (fl > 30) { dx += fx / fl * 0.6; dy += fy / fl * 0.6; }
                    }
                    thr = botsClamp(Math.hypot(dx, dy), 0.35, 1);
                    if (b.faceLock || d < R * 1.25) face = t;
                }
            }
        } else if (b.act === 'follow') {
            const f = b.follow;
            if (!f || f.disposed || f.state === 'dead' || f.zone !== b.zone) { b.act = 'idle'; b.follow = null; }
            else {
                let px, py;
                if (f.isPlayer) {
                    const d = Math.hypot(c.x - f.x, c.y - f.y) || 1;
                    px = f.x + (c.x - f.x) / d * 300; py = f.y + (c.y - f.y) / d * 300;
                } else {
                    const h = f.heading, s = b.side * 150;
                    px = f.x - Math.cos(h) * 110 - Math.sin(h) * s; py = f.y - Math.sin(h) * 110 + Math.cos(h) * s;
                }
                const gx = px - c.x, gy = py - c.y, gd = Math.hypot(gx, gy);
                if (gd > (f.isPlayer ? 140 : 70)) { dx = gx; dy = gy; thr = Math.min(1, 0.35 + gd / 260); b.goalD = gd; }
                else if (f.speed < 30 && Math.random() < 0.01) c.faceTo(f.x, f.y, 1.5);
            }
        } else if (b.act === 'wander' || b.act === 'walk' || b.act === 'ped' || b.act === 'board' || b.act === 'portal') {
            const gx = b.gx - c.x, gy = b.gy - c.y, gd = Math.hypot(gx, gy);
            if (gd <= b.goalR) this._arrive(b);
            else { dx = gx; dy = gy; thr = (gd < 200 ? Math.max(0.45, gd / 200) : 1) * b.thr; b.goalD = gd; }
            if (!this.bots.has(c)) return;   // ушёл в портал
        }
        // Шлепок — кто в досягаемости (цель, обидчик или подвернувшийся).
        if (c.canSlap() && now >= b.slapAt && now >= b.reactAt && b.act !== 'afk' && Game.pvp(b.zone)) this._autoSlap(b);
        // Курс: шум «руки на стике», обход препятствий, сглаживание, край.
        let mx = 0, my = 0;
        if (thr > 0.01) {
            const l = Math.hypot(dx, dy);
            if (l > 1e-4) {
                dx /= l; dy /= l;
                const w = Math.sin(now * b.wobF + b.wob) * b.noise + Math.sin(now * b.wobF * 2.3 + b.wob * 1.7) * b.noise * 0.45;
                const cw = Math.cos(w), sw = Math.sin(w);
                const a = this._avoidCols(b, dx * cw - dy * sw, dx * sw + dy * cw);
                mx = a.x * thr; my = a.y * thr;
            }
        }
        const k = 1 - Math.exp(-dt * b.turnK);
        b.mx += (mx - b.mx) * k; b.my += (my - b.my) * k;
        this._avoidEdge(b);
        c.setMove(b.mx, b.my);
        if (face) c.faceTo(face.x, face.y, 0.12);
    },

    // Обход препятствий впереди по курсу (dx, dy — единичный). Общий объект — копировать.
    _avoidCols(b, dx, dy) {
        const c = b.c, out = this._v, rr = GameCfg.charRadius;
        let ax = dx, ay = dy;
        for (const k of b.cols) {
            if (c.h > k.top) continue;
            const vx = k.x - c.x, vy = k.y - c.y;
            const ahead = vx * dx + vy * dy, look = 230 + k.r;
            if (ahead < -k.r || ahead > look) continue;
            const side = vx * -dy + vy * dx, clear = k.r + rr + 30;
            if (Math.abs(side) >= clear) continue;
            const w = (1 - Math.max(0, ahead) / look) * (1 - Math.abs(side) / clear) * 2.2;
            const s = side >= 0 ? -1 : 1;
            ax += -dy * s * w; ay += dx * s * w;
        }
        const l = Math.hypot(ax, ay) || 1;
        out.x = ax / l; out.y = ay / l;
        return out;
    },

    // Край: точка впереди по ходу ближе запаса к краю -> курс внутрь (доля «наружу» гасится).
    _avoidEdge(b) {
        const c = b.c, sp = Math.hypot(b.mx, b.my);
        if (sp < 0.03 || !c.onGround || Game.time < b.lapseUntil) return;
        const ux = b.mx / sp, uy = b.my / sp;
        const L = Math.min(110 + Math.max(c.speed, 200) * 0.4, b.goalD + 40);
        const el = GameWorld.edgeDist(c.x + ux * L, c.y + uy * L, b.zone);
        const m = b.edgeM * (b.goalD < Infinity ? 0.5 : 1);
        if (el >= m) return;
        const g = this._inward(c.x, c.y, b.zone);
        const k = Math.min(1.6, (m - el) / m);
        let nx = ux, ny = uy;
        const dot = ux * g.x + uy * g.y;
        if (dot < 0) { const q = Math.min(1, k); nx -= g.x * dot * q; ny -= g.y * dot * q; }
        nx += g.x * k * 0.8; ny += g.y * k * 0.8;
        const l = Math.hypot(nx, ny) || 1;
        b.mx = nx / l * sp; b.my = ny / l * sp;
    },

    // Шлепок: цель / обидчик / кто подвернулся в досягаемости перед собой; промах — от skill.
    _autoSlap(b) {
        const c = b.c, R = GameCombat.range(c), reach = R * b.reachK;
        let best = null, bs = Infinity;
        for (const o of Game.chars) {
            if (o === c || o.invisible || !GameCombat.canHit(c, o)) continue;
            if (o.isPlayer && b.target !== o && this._onPlayer >= BOT_MAX_ON_PLAYER) continue;
            const dx = o.x - c.x, dy = o.y - c.y, d = Math.hypot(dx, dy);
            if (d > reach) continue;
            let ang = Math.atan2(dy, dx) - c.heading;
            while (ang > Math.PI) ang -= Math.PI * 2;
            while (ang < -Math.PI) ang += Math.PI * 2;
            if (Math.abs(ang) > (o === b.target ? 1.9 : 1.2)) continue;
            let s = d;
            if (o === b.target) s *= 0.5;
            if (o === b.grudge) s *= 0.6;
            if (s < bs) { bs = s; best = o; }
        }
        if (!best) return;
        const miss = Math.random() < BOT_MISS_BASE + BOT_MISS_SKILL * (1 - b.skill);
        if (GameCombat.trySlap(c, best, { miss })) {
            b.slapAt = c.nextSlapAt + Math.random() * 0.35 * (1.1 - b.skill);
            b.reachK = botsRand(0.8, 1.05);
            if (b.act === 'emote') b.act = 'idle';
        }
    },

    // --- События ---------------------------------------------------------------------------------

    _onSlap(e) {
        const a = e.attacker, v = e.victim;
        if (a && this.bots.has(a)) this.stats.slaps++;
        const bv = v ? this.bots.get(v) : null;
        if (!bv || !a || a === v || bv.act === 'afk') return;   // AFK не реагирует — его нет у экрана
        const now = Game.time;
        const want = bv.kind === 'avenger' ? 0.9 : bv.kind === 'newbie' ? 0.15 : 0.25;
        if (Math.random() < want && !(v.team && v.team === a.team)) {
            const fresh = bv.grudge !== a;
            bv.grudge = a;
            bv.grudgeUntil = now + BOT_GRUDGE * (bv.kind === 'avenger' ? 1.5 : 0.8) * botsRand(0.7, 1.3);
            if (fresh && Math.random() < 0.3) this._later(botsRand(0.6, 1.4), () => this._say(bv, 'revenge', { name: a.name }));
        } else if (Math.random() < 0.07) this._later(botsRand(0.3, 1.0), () => this._say(bv, 'hit'));
        // Друг заступается.
        const f = bv.friend ? this.bots.get(bv.friend) : null;
        if (f && f.zone === bv.zone && f.act !== 'afk' && a !== f.c && Math.random() < 0.7) {
            f.grudge = a; f.grudgeUntil = now + BOT_GRUDGE * 0.7;
            if (Math.random() < 0.15) this._later(botsRand(0.5, 1.2), () => this._say(f, 'friendHelp', { friend: v.name }));
        }
    },

    _onKo(e) {
        const v = e.victim, k = e.killer;
        const bv = v ? this.bots.get(v) : null, bk = k ? this.bots.get(k) : null;
        if (bv) {
            this.stats.falls++;
            bv.deaths++;
            bv.target = null; bv.act = 'idle'; bv.follow = null;
            const hitRecently = v.lastHitBy && Game.time - v.lastHitTime < 10;
            if (!k && !hitRecently) { this.stats.selfFalls++; bv.pending = Math.random() < 0.45 ? 'selfFall' : ''; }
            else bv.pending = Math.random() < (bv.kind === 'avenger' ? 0.5 : 0.28) ? 'koLose' : '';
            if (k && k !== v && (bv.kind === 'avenger' || Math.random() < 0.3)) { bv.grudge = k; bv.grudgeUntil = Game.time + BOT_GRUDGE * 2; }
            if (bv.respawn) {
                bv.respawnAt = Game.realTime + botsRand(BOT_RESPAWN_MIN, BOT_RESPAWN_MAX);
                bv.quitting = Math.random() < BOT_QUIT && !(bv.friend && !bv.friend.disposed);
            }
        }
        if (bk && v !== k) {
            this.stats.kos++;
            bk.kills++;
            if (bk.grudge === v) bk.grudge = null;
            if (bk.target === v) bk.target = null;
            if (Math.random() < (bk.kind === 'showoff' ? 0.75 : 0.12)) this._later(botsRand(0.15, 0.5), () => this._brag(bk, v));
            const cat = v.isPlayer ? (bk.kind === 'fan' ? 'fanSorry' : 'koPlayer') : 'koWin';
            const pr = bk.kind === 'showoff' ? 0.6 : v.isPlayer ? 0.3 : 0.16;
            if (Math.random() < pr) this._later(botsRand(0.3, 1.1), () => this._say(bk, cat));
        }
        // Игрок упал сам — кто-нибудь рядом смеётся.
        if (v && v === Game.player && !k && Math.random() < 0.15) {
            const b = this._nearestBot(v, 900);
            if (b) this._later(botsRand(0.4, 1.2), () => this._say(b, 'playerFell'));
        }
    },

    // Снова в игре (сам или по GameModes): сброс решений, «осмотреться», отложенная реплика.
    _onRespawn(e) {
        const b = e && e.char ? this.bots.get(e.char) : null;
        if (!b) return;
        const c = b.c, now = Game.time;
        b.zone = c.zone;
        b.act = 'idle'; b.target = null; b.follow = null;
        b.waitUntil = now + botsRand(0.2, 0.8);
        b.reactAt = now + this._reaction(b) * 1.5;
        b.slapAt = b.reactAt;
        b.thinkAt = now + botsRand(0.1, 0.5);
        b.mx = b.my = 0; b.stuckT = 0; b.lastX = c.x; b.lastY = c.y; b.lastT = now;
        b.unstuckUntil = 0; b.lapseUntil = 0; b.recover = false; b.leaving = false;
        if (b.pending) { const cat = b.pending; b.pending = ''; this._later(botsRand(0.6, 1.8), () => this._say(b, cat)); }
    },

    _onRound(e) {
        if (!e || e.mode !== 'duel' || e.result !== 'lose') return;
        for (const b of this.bots.values()) if (b.zone === 'duel') this._later(botsRand(0.4, 1), () => this._say(b, 'duelWin', null, true));
    },

    // Игрок взял перчатку в лобби — кто-то рядом заметил.
    _onGlove(e) {
        const ch = e && e.char;
        if (!ch || !ch.isPlayer || ch.zone !== 'lobby' || Math.random() > 0.3) return;
        const b = this._nearestBot(ch, 800);
        if (b) this._later(botsRand(0.6, 1.6), () => this._say(b, 'glovePlayer', { glove: this._gloveName(e.glove) }));
    },

    // Поздороваться с игроком (вход в лобби/на арену): реплика, в лобби — помахать.
    _greetPlayer(zone, delay) {
        this._later(delay, () => {
            const p = Game.player;
            if (!p || p.zone !== zone) return;
            const list = Array.from(this.bots.values()).filter(b => b.zone === zone && b.c.canAct() && b.act !== 'afk' &&
                Math.hypot(b.c.x - p.x, b.c.y - p.y) < 1800);
            if (!list.length) return;
            const b = botsPick(list);
            if (this._say(b, 'newPlayer') && zone === 'lobby' && Math.hypot(b.c.x - p.x, b.c.y - p.y) < 900) this._emote(b, 'wave', 1.8, p);
            if (list.length > 2 && Math.random() < 0.5) {
                this._later(botsRand(3.8, 6), () => {
                    const b2 = botsPick(list);
                    if (b2 !== b && this.bots.has(b2.c)) this._say(b2, 'greet');
                });
            }
        });
    },

    _nearestBot(ch, maxD) {
        let best = null, bd = maxD;
        for (const b of this.bots.values()) {
            const c = b.c;
            if (c === ch || c.zone !== ch.zone || !c.canAct() || b.act === 'afk') continue;
            const d = Math.hypot(c.x - ch.x, c.y - ch.y);
            if (d < bd) { bd = d; best = b; }
        }
        return best;
    },

    // --- Чат ---------------------------------------------------------------------------------------

    _later(sec, fn) { this._timers.push({ at: Game.realTime + sec, fn }); },

    // Случайная реплика раз в 9–22 с — от бота рядом с игроком.
    _idleChat() {
        const rt = Game.realTime;
        if (rt < this._idleChatAt) return;
        this._idleChatAt = rt + botsRand(BOT_IDLE_CHAT_MIN, BOT_IDLE_CHAT_MAX);
        const p = Game.player;
        if (!Game.started || !p) return;
        const cands = [];
        for (const b of this.bots.values()) {
            const c = b.c;
            if (c.zone !== p.zone || !c.canAct() || b.act === 'afk' || b.leaving || Math.hypot(c.x - p.x, c.y - p.y) > 1600) continue;
            cands.push(b);
        }
        if (!cands.length) return;
        const b = botsPick(cands);
        const mode = typeof GameModes !== 'undefined' ? GameModes.current : Game.mode;
        const cat = b.zone === 'lobby' ? 'lobby' : b.zone === 'royale' ? 'royale' : b.zone === 'duel' ? 'duelTalk'
            : mode === 'hardcore' && Math.random() < 0.4 ? 'hardcore' : 'arena';
        if (b.friend && !b.friend.disposed && Math.random() < 0.25) this._say(b, 'friend', { friend: b.friend.name });
        else if (b.kind === 'fan' && Math.random() < 0.5) this._say(b, 'fan');
        else this._say(b, cat);
    },

    // Пузырь чата: редко и к месту (общий интервал + свой у бота), только рядом с игроком.
    _say(b, cat, vars, force) {
        const c = b.c, p = Game.player, rt = Game.realTime;
        if (!Game.started || !p || c.disposed || c.state === 'dead' || c.zone !== p.zone || !this.bots.has(c)) return false;
        if (!force && (rt < this._chatAt || rt < b.chatAt)) return false;
        if (Math.hypot(c.x - p.x, c.y - p.y) > BOT_CHAT_DIST) return false;
        const bank = BOT_CHAT[cat];
        if (!bank) return false;
        const lines = b.ru ? bank.ru : bank.en;
        if (!lines || !lines.length) return false;
        let line = botsPick(lines);
        for (let k = 0; k < 4 && this._recent.indexOf(line) >= 0; k++) line = botsPick(lines);
        /** @type {Record<string, any>} */
        const v = Object.assign({ player: p.name }, vars || {});
        let text = this._style(b, line, bank.mood);
        let missing = false;
        text = text.replace(/\{(\w+)\}/g, (m, key) => {
            const val = v[String(key).toLowerCase()];
            if (val == null) { missing = true; return m; }
            return String(val);
        });
        if (missing) return false;
        this._recent.push(line);
        if (this._recent.length > 12) this._recent.shift();
        c.say(text);
        this.stats.chats++;
        this._chatAt = rt + botsRand(BOT_CHAT_GAP_MIN, BOT_CHAT_GAP_MAX);
        b.chatAt = rt + botsRand(BOT_CHAT_SELF_MIN, BOT_CHAT_SELF_MAX);
        return true;
    },

    // Почерк: строчные, иногда КАПС, опечатки, «)))» и смайлы.
    _style(b, s, mood) {
        let t = s;
        if (Math.random() < b.caps) return t.toUpperCase() + (Math.random() < 0.5 ? '!!' : '!!!');
        if (Math.random() < 0.75) t = t.toLowerCase();
        if (Math.random() < b.typo) t = botsTypo(t);
        const last = t.codePointAt(t.length - 1) || 0;
        const plain = last < 0x2000 && !/[)!?]$/.test(t);
        if (b.ru && mood > 0 && plain && Math.random() < b.paren) t += ')'.repeat(1 + Math.floor(Math.random() * 3));
        else if (mood !== 0 && plain && Math.random() < b.smile * 0.35) t += ' ' + botsPick(mood > 0 ? BOT_EMOJI_POS : BOT_EMOJI_NEG);
        return t;
    },

    // Строка «Ник присоединился / вышел» в ленте — редко.
    _notice(key, name) {
        const rt = Game.realTime;
        if (!Game.started || rt < this._noticeAt || Math.random() > BOT_NOTICE_CHANCE) return;
        if (typeof GameUI === 'undefined' || typeof GameUI.notice !== 'function') return;
        this._noticeAt = rt + BOT_NOTICE_GAP;
        GameUI.notice(Lang.t(key, { name }));
    },
};
