// GameWardrobe.js — гардероб игрока и косметика персонажей. Каталог — COSMETICS
// (GameCosmeticsData.js, генерирует tools/cosmetics/gen_catalog.py): 6 вкладок (acc: слоты hat |
// glasses | back; hair, face, shirt, pants, aura). Вещь — за ауру (price, тратится: Game.spendAura)
// или за 1–5 просмотров рекламы (ads: Game.adUnlock('cos_' + id, ads)); default — выдана сразу;
// exclusive 'daily' — только из ежедневного подарка (в гардеробе видна с замком и подписью).
//
// Внешность игрока — каталожный look { skin, hair, face, shirt, pants, hat, glasses, back, aura }
// (Character.setAppearance рисует модели, лицо, композит одежды). Стандартный вид — кожа
// WR_SKIN, пробор, улыбка, оранжевая футболка «+1», чёрные джинсы (вещи default каталога).
// Сохранение: Game.save.cos = { owned: [id…] (с default), equip: { hat, glasses, back, hair, face,
// shirt, pants, aura } (id | null), fresh: [id…] — новые вещи (метка на кнопке HUD) };
// migrate(save) зовёт Game._loadSave (старые сохранения — стандартный набор).
//
// Окно: кнопка HUD «Гардероб» (только в лобби); персонаж стоит (GamePlayer.frozen), камера
// спереди крупно (поверх GameCamera, плавно туда и обратно), персонажа можно крутить
// перетаскиванием. Раскладка: альбом — панель справа, персонаж слева; портрет — панель снизу
// (~55% высоты), персонаж сверху. Карточка = мгновенная примерка (примерки по слотам копятся,
// закрытие — возврат к надетому); кнопки: «Купить за N ауры» / «Не хватает ауры», «Смотреть
// рекламу k/N», «Надеть» / «Снять» (лицо, рубашку и штаны снять нельзя — только сменить).
//
// Аура-эффект персонажа (look.aura -> aura { tex, color, style }): одна система частиц на
// персонажа (эмиттер у ног следует за ним), стиль rise | orbit | swirl | fall |
// burst | pulse; aura_rainbow — смена цвета, aura_glitch — RGB-вспышки. Нет при смерти, скрытии,
// падении в бездну, далеко от камеры; у ботов — только у WR_AURA_BOTS ближайших к камере, плотность
// ниже у ботов и на low (GameFX.quality). Цветные текстуры, тонированные чужим цветом, — в серый.
//
// Боты: botLook(aura, archetype, kind) — вещи каталога по архетипу GameBots._look (пулы WR_BOT), чем
// больше аура — тем дороже вещи; эффект ауры — только у богатых. Конфликты шапка/причёска —
// Character.hatHidesHair (бот такие пары почти не собирает).
//
// API: owns(id), give(id, { equip }) -> true (вещь у игрока), equip(id), unequip(slot),
// lookOfPlayer(), open(tab?) -> bool, close(), select(id) (вкладка + примерка), isOpen,
// migrate(save), defaults(), botLook(aura, arch, kind). Событие cosmetic { id, equip } — выдана/надета.
// Game.debug.wardrobe() — сводка (?debug).

const WR_SKIN = 0xf2c49b;          // кожа игрока
const WR_AURA_BOTS = 3;            // ботов с эффектом ауры одновременно (ближайшие к камере)
const WR_AURA_DIST = 3200;         // px от камеры: дальше эффект ауры не показывается
const WR_AURA_LOW = 0.55;          // плотность эффекта ауры на low
const WR_AURA_BOT = 0.6;           // плотность эффекта ауры у ботов
const WR_AURA_RICH = 500;          // аура бота: с неё бывают эффекты ауры
const WR_CAM_BLEND = 0.45;         // с: наезд камеры в гардероб и обратно
const WR_CAM_PITCH = 0.1;          // рад: камера чуть сверху
const WR_CAM_YAW = 0.42;           // рад: камера сбоку от фаса (вид 3/4)
const WR_CAM_FILL = 0.68;          // доля области персонажа по высоте/ширине, которую он занимает
const WR_CAM_FOV = 0.72;           // рад: вертикальный FOV в гардеробе (уже игрового — меньше искажений вблизи)
const WR_TURN = 0.011;             // рад на px: поворот персонажа перетаскиванием
const WR_FLASH = 2.6;              // с: сообщение в подвале окна

Object.assign(LANG_STRINGS.ru, {
    'wardrobe': 'Гардероб',
    'wrWorn': 'Надето',
    'wrOwned': 'Есть',
    'wrWear': 'Надеть',
    'wrTakeOff': 'Снять',
    'wrBuy': 'Купить за {n} ауры',
    'wrNoAura': 'Не хватает ауры',
    'wrNeed': 'Нужно ещё {n} ауры',
    'wrAd': 'Смотреть рекламу {k}/{n}',
    'wrAdBusy': 'Реклама…',
    'wrAdFail': 'Реклама сейчас недоступна',
    'wrAdLeft': 'Засчитано! Осталось просмотров: {n}',
    'wrGift': 'Подарок 7-го дня',
    'wrGiftNote': 'Только из ежедневного подарка',
    'wrHint': 'Нажми на вещь — она сразу примерится',
    'wrTry': 'Примерка · нажми ещё раз, чтобы убрать',
    'wrGot': 'Новая вещь: {name}!',
    'wrNew': 'NEW',
    'wrKeep': 'Без этой вещи нельзя — выбери другую',
    'wrSlot_hat': 'Голова', 'wrSlot_glasses': 'Очки', 'wrSlot_back': 'Спина', 'wrSlot_hair': 'Причёска',
    'wrSlot_face': 'Лицо', 'wrSlot_shirt': 'Одежда', 'wrSlot_pants': 'Штаны', 'wrSlot_aura': 'Аура',
});
Object.assign(LANG_STRINGS.en, {
    'wardrobe': 'Wardrobe',
    'wrWorn': 'Equipped',
    'wrOwned': 'Owned',
    'wrWear': 'Wear',
    'wrTakeOff': 'Take off',
    'wrBuy': 'Buy for {n} aura',
    'wrNoAura': 'Not enough aura',
    'wrNeed': '{n} more aura needed',
    'wrAd': 'Watch ad {k}/{n}',
    'wrAdBusy': 'Ad…',
    'wrAdFail': 'Ad is not available right now',
    'wrAdLeft': 'Counted! Views left: {n}',
    'wrGift': 'Day 7 gift',
    'wrGiftNote': 'Only from the daily gift',
    'wrHint': 'Tap an item to try it on',
    'wrTry': 'Trying on · tap again to remove',
    'wrGot': 'New item: {name}!',
    'wrNew': 'NEW',
    'wrKeep': 'Can\'t go without it — pick another one',
    'wrSlot_hat': 'Head', 'wrSlot_glasses': 'Glasses', 'wrSlot_back': 'Back', 'wrSlot_hair': 'Hair',
    'wrSlot_face': 'Face', 'wrSlot_shirt': 'Shirt', 'wrSlot_pants': 'Pants', 'wrSlot_aura': 'Aura',
});

/** @typedef {{ id: string, tab: string, slot: string, ru: string, en: string, price?: number, ads?: number, model?: string, color?: number, texture?: string, tone?: number, cut?: string, aura?: { tex: string, color: number, style: string }, icon: string, default?: boolean, exclusive?: string }} CosItem */
/** @typedef {{ hat: string | null, glasses: string | null, back: string | null, hair: string | null, face: string | null, shirt: string | null, pants: string | null, aura: string | null }} CosEquip */

const WR_SLOTS = ['hat', 'glasses', 'back', 'hair', 'face', 'shirt', 'pants', 'aura'];
/** @type {Record<string, number>} слоты, которые нельзя оставить пустыми */
const WR_REQUIRED = { face: 1, shirt: 1, pants: 1 };
/** @type {Record<number, number>} цена в ауре -> уровень вещи (1–5) */
const WR_TIER = { 60: 1, 140: 2, 280: 3, 500: 4, 900: 5 };

// Пулы вещей ботов по архетипу GameBots._look ('*' на конце — все вещи с таким началом id; null —
// ничего). P — шанс слота (по умолчанию: обязательные — 1, остальные — 0), skin — свои тона кожи.
/** @type {Record<string, Record<string, any>>} */
const WR_BOT = {
    // Новичок: стартовая одежда игры и простые вещи.
    rookie: { hair: ['hair_side_part_brown', 'hair_side_part_black', 'hair_buzz_brown', 'hair_buzz_black'],
        shirt: ['shirt_starter', 'shirt_starter', 'shirt_tee_white', 'shirt_tee_red', 'shirt_tee_black'],
        pants: ['pants_jeans_black', 'pants_jeans_black', 'pants_shorts_khaki', 'pants_track_black'],
        face: ['face_smile', 'face_happy', 'face_silly', 'face_grin'] },
    bacon: { hair: ['hair_spiky_brown', 'hair_spiky_black', 'hair_buzz_brown', 'hair_buzz_black', 'hair_side_part_brown', 'hair_side_part_black'],
        shirt: ['shirt_tee_white', 'shirt_tee_black', 'shirt_tee_red', 'shirt_tee_yellow', 'shirt_starter', 'shirt_hoodie_gray', 'shirt_jersey_red', 'shirt_aura_tee', 'shirt_track_jacket', 'shirt_varsity'],
        pants: ['pants_jeans_blue', 'pants_jeans_black', 'pants_track_black', 'pants_shorts_blue', 'pants_cargo_green', 'pants_joggers_gray', 'pants_track_neon'],
        face: ['face_smile', 'face_happy', 'face_grin', 'face_smirk', 'face_aura', 'face_locked_in'], hat: ['cap_*'], P: { hat: 0.12 } },
    girl: { hair: ['hair_long_*', 'hair_ponytail_*', 'hair_pigtails_*', 'hair_bun_brown', 'hair_curly_*'],
        shirt: ['shirt_hoodie_pink', 'shirt_tee_white', 'shirt_stripes_red', 'shirt_tee_yellow', 'shirt_tiedye', 'shirt_rainbow', 'shirt_hawaiian'],
        pants: ['pants_skirt_pink', 'pants_pink', 'pants_white', 'pants_jeans_blue', 'pants_purple', 'pants_shorts_blue'],
        face: ['face_girl', 'face_cute', 'face_wink', 'face_happy', 'face_blush', 'face_kiss', 'face_heart_eyes'],
        hat: ['cat_ears_pink', 'bunny_ears', 'flower_crown', 'headphones_red'], glasses: ['sunglasses', 'glasses_round'],
        back: ['butterfly_pink', 'backpack_red', 'wings_angel', 'butterfly_blue'], aura: ['aura_hearts', 'aura_sakura', 'aura_butterflies', 'aura_rainbow'],
        P: { hat: 0.35, glasses: 0.12, back: 0.15 } },
    bob: { hair: ['hair_bob_*', 'hair_side_part_*'], shirt: ['shirt_tee_white', 'shirt_tee_yellow', 'shirt_stripes_navy', 'shirt_hoodie_green', 'shirt_flannel_red'],
        pants: ['pants_jeans_blue', 'pants_white', 'pants_jeans_black', 'pants_shorts_khaki'], face: ['face_cute', 'face_smile', 'face_smirk', 'face_wink', 'face_happy'],
        hat: ['cap_*', 'beanie_*', 'tophat', 'headphones_red'], P: { hat: 0.35 } },
    ninja: { hair: ['hair_buzz_black', null], shirt: ['shirt_ninja'], pants: ['pants_ninja'], face: ['face_ninja', 'face_angry', 'face_cool', 'face_evil'],
        back: ['sword'], glasses: ['eyepatch'], aura: ['aura_shadow', 'aura_smoke', 'aura_fire_purple'], P: { back: 0.8, glasses: 0.1 } },
    robot: { skin: [0xa3a2a5, 0x8a8f99, 0xc7ccd1], hair: [null], shirt: ['shirt_robot'], pants: ['pants_robot'], face: ['face_robot', 'face_shocked', 'face_cool'],
        hat: ['headphones_red'], glasses: ['ski_goggles'], aura: ['aura_electric', 'aura_pixels', 'aura_glitch'], P: { hat: 0.3, glasses: 0.2 } },
    hoodie: { hair: ['hair_spiky_*', 'hair_side_part_*', 'hair_buzz_*'], shirt: ['shirt_hoodie_*', 'shirt_neon_hoodie', 'shirt_graffiti_hoodie', 'shirt_puffer_black', 'shirt_windbreaker'], pants: ['pants_jeans_*', 'pants_track_*', 'pants_cargo_green', 'pants_joggers_gray', 'pants_cargo_black', 'pants_baggy_jeans'],
        face: ['face_smirk', 'face_cool', 'face_smile', 'face_grin', 'face_bored', 'face_locked_in', 'face_side_eye', 'face_npc'], hat: ['headphones_red', 'cap_black', 'beanie_gray', 'snapback_black', 'bucket_black', 'headphones_neon_black'], glasses: ['shades_black', 'shades_white'], back: ['chain_silver'], P: { hat: 0.4 } },
    pastel: { hair: ['hair_bob_purple', 'hair_long_pink', 'hair_pigtails_pink', 'hair_bun_white', 'hair_afro_pink'],
        shirt: ['shirt_hoodie_pink', 'shirt_tiedye', 'shirt_rainbow', 'shirt_tee_white', 'shirt_puffer_purple', 'shirt_holo_jacket'], pants: ['pants_pink', 'pants_white', 'pants_purple', 'pants_skirt_pink', 'pants_holo', 'pants_drip'],
        face: ['face_cute', 'face_happy', 'face_wink', 'face_girl', 'face_blush'], hat: ['cat_ears_pink', 'bunny_ears', 'flower_crown'],
        back: ['butterfly_pink', 'butterfly_blue'], aura: ['aura_sakura', 'aura_bubbles', 'aura_rainbow', 'aura_hearts', 'aura_pink_neon'], glasses: ['shades_pink', 'shutter_pink'], P: { hat: 0.5, back: 0.2 } },
    emo: { hair: ['hair_bob_black', 'hair_long_black', 'hair_bob_purple'], shirt: ['shirt_hoodie_black', 'shirt_tee_black', 'shirt_jacket_leather', 'shirt_puffer_black', 'shirt_graffiti_hoodie'],
        pants: ['pants_jeans_black', 'pants_track_black', 'pants_checkered'], face: ['face_sleepy', 'face_worried', 'face_bored', 'face_sad', 'face_smirk', 'face_side_eye', 'face_npc'],
        hat: ['headphones_red'], aura: ['aura_shadow', 'aura_smoke', 'aura_phonk_smoke'], P: { hat: 0.3 } },
    sporty: { hair: ['hair_buzz_*', 'hair_spiky_*', 'hair_ponytail_*'], shirt: ['shirt_jersey_red', 'shirt_jersey_blue', 'shirt_tee_red', 'shirt_tee_white', 'shirt_jersey_99', 'shirt_track_jacket', 'shirt_windbreaker'],
        pants: ['pants_sport_shorts_red', 'pants_track_*', 'pants_shorts_blue', 'pants_shorts_mesh', 'pants_track_neon'], face: ['face_grin', 'face_happy', 'face_smile', 'face_cool'],
        hat: ['cap_*', 'snapback_black', 'snapback_purple'], back: ['backpack_*'], P: { hat: 0.6, back: 0.25 } },
    rich: { hair: ['hair_side_part_blonde', 'hair_side_part_black', 'hair_long_blonde', 'hair_bob_black'], shirt: ['shirt_suit_black', 'shirt_tuxedo', 'shirt_royal', 'shirt_holo_jacket', 'shirt_varsity', 'shirt_puffer_purple'],
        pants: ['pants_suit_black', 'pants_white', 'pants_royal', 'pants_holo', 'pants_techwear'], face: ['face_money', 'face_smirk', 'face_cool', 'face_star_eyes', 'face_rizz', 'face_aura', 'face_sigma'],
        hat: ['crown', 'tophat', 'halo', 'halo_neon_cyan', 'halo_neon_pink', 'halo_double', 'bucket_tan'], glasses: ['sunglasses', 'shades_black', 'shades_pink', 'visor_cyan'], back: ['cape_red', 'cape_black', 'cape_royal', 'wings_angel', 'jetpack', 'chain_gold', 'chain_iced', 'chain_medal_gold', 'wings_neon_gold'],
        aura: ['aura_gold_sparkle', 'aura_money', 'aura_galaxy', 'aura_royal', 'aura_infinity', 'aura_diamond_rain', 'aura_iced'], P: { hat: 0.85, glasses: 0.55, back: 0.5, aura: 0.55 } },
    demon: { hair: ['hair_spiky_black', 'hair_mohawk_red', 'hair_long_black', null], shirt: ['shirt_tee_black', 'shirt_jacket_leather', 'shirt_hoodie_black', 'shirt_flame_tee'],
        pants: ['pants_jeans_black', 'pants_lava', 'pants_track_black', 'pants_flame'], face: ['face_evil', 'face_vampire', 'face_angry', 'face_smirk'],
        hat: ['horns'], back: ['bat_wings', 'dragon_wings', 'cape_black'], aura: ['aura_fire', 'aura_fire_purple', 'aura_shadow', 'aura_embers', 'aura_sunset'],
        P: { hat: 0.9, back: 0.7, aura: 0.45 } },
    angel: { hair: ['hair_side_part_blonde', 'hair_long_blonde', 'hair_bun_white', 'hair_curly_ginger'], shirt: ['shirt_tee_white', 'shirt_doctor', 'shirt_chef'],
        pants: ['pants_white'], face: ['face_happy', 'face_cute', 'face_smile', 'face_blush'], hat: ['halo', 'halo_neon_cyan', 'halo_neon_pink', 'halo_double'], back: ['wings_angel', 'wings_neon'],
        aura: ['aura_gold_sparkle', 'aura_stars', 'aura_snow'], P: { hat: 0.85, back: 0.85, aura: 0.35 } },
    gamer: { hair: ['hair_spiky_*', 'hair_bob_*', 'hair_mohawk_*', 'hair_side_part_*'],
        shirt: ['shirt_hoodie_black', 'shirt_hoodie_green', 'shirt_galaxy_hoodie', 'shirt_tee_black', 'shirt_camo', 'shirt_neon_hoodie', 'shirt_glow_vest', 'shirt_track_jacket'],
        pants: ['pants_jeans_black', 'pants_cargo_green', 'pants_camo', 'pants_galaxy', 'pants_track_neon', 'pants_techwear'], face: ['face_cool', 'face_grin', 'face_smirk', 'face_nerd', 'face_dizzy', 'face_locked_in', 'face_neon', 'face_npc', 'face_mewing'],
        hat: ['headphones_red', 'cap_black', 'propeller_cap', 'headphones_neon_black', 'headphones_neon_white'], glasses: ['ski_goggles', 'sunglasses', 'glasses_round', 'visor_cyan', 'shades_black', 'shutter_lime'],
        aura: ['aura_pixels', 'aura_electric', 'aura_glitch', 'aura_lightning', 'aura_neon_swirl', 'aura_neon_pulse', 'aura_acid'], P: { hat: 0.55, glasses: 0.3 } },
    skater: { hair: ['hair_side_part_*', 'hair_curly_*', 'hair_long_*'], shirt: ['shirt_flannel_red', 'shirt_tee_yellow', 'shirt_hawaiian', 'shirt_tiedye', 'shirt_stripes_red', 'shirt_drip_tee', 'shirt_aura_tee', 'shirt_jersey_99', 'shirt_flame_tee'],
        pants: ['pants_shorts_khaki', 'pants_cargo_green', 'pants_jeans_blue', 'pants_plaid_red', 'pants_shorts_mesh', 'pants_camo_urban', 'pants_drip', 'pants_flame'], face: ['face_smile', 'face_grin', 'face_silly', 'face_laugh', 'face_side_eye', 'face_sigma', 'face_mewing'],
        hat: ['beanie_*', 'cap_*', 'snapback_purple', 'snapback_black', 'bucket_tan'], back: ['backpack_*', 'guitar'], glasses: ['shutter_lime', 'shutter_pink', 'shades_pink'], aura: ['aura_phonk_smoke', 'aura_sunset'], P: { hat: 0.6, back: 0.4 } },
    gent: { hair: ['hair_side_part_*'], shirt: ['shirt_suit_black', 'shirt_tuxedo'], pants: ['pants_suit_black'], face: ['face_smirk', 'face_cool', 'face_nerd'],
        hat: ['tophat'], glasses: ['glasses_round', 'sunglasses'], P: { hat: 0.85, glasses: 0.4 } },
    // Тематические наборы (архетип random — один из них или всё вперемешку).
    pirate: { hair: ['hair_long_black', 'hair_curly_brown', 'hair_buzz_black'], shirt: ['shirt_pirate'], pants: ['pants_pirate_striped'],
        face: ['face_smirk', 'face_grin', 'face_evil'], hat: ['pirate_hat'], glasses: ['eyepatch'], back: ['sword'], P: { hat: 0.85, glasses: 0.6, back: 0.3 } },
    knight: { hair: ['hair_side_part_*', 'hair_long_blonde'], shirt: ['shirt_knight'], pants: ['pants_armor'], face: ['face_cool', 'face_angry', 'face_smile'],
        hat: ['viking'], back: ['shield', 'sword', 'cape_red'], P: { hat: 0.6, back: 0.8 } },
    astronaut: { hair: ['hair_buzz_*', 'hair_side_part_*'], shirt: ['shirt_astronaut'], pants: ['pants_astronaut'], face: ['face_star_eyes', 'face_happy', 'face_shocked'],
        back: ['jetpack', 'backpack_blue'], aura: ['aura_stars', 'aura_galaxy'], P: { back: 0.7 } },
    cowboy: { hair: ['hair_side_part_*', 'hair_buzz_brown'], shirt: ['shirt_flannel_red', 'shirt_tee_white'], pants: ['pants_jeans_blue', 'pants_cargo_green'],
        face: ['face_smirk', 'face_cool', 'face_grin'], hat: ['cowboy'], P: { hat: 0.9 } },
    chef: { hair: ['hair_side_part_*', 'hair_bun_*'], shirt: ['shirt_chef'], pants: ['pants_white', 'pants_plaid_red'], face: ['face_happy', 'face_laugh', 'face_smile'],
        hat: ['chef_hat'], P: { hat: 0.9 } },
    wizard: { hair: ['hair_long_*', 'hair_curly_*'], shirt: ['shirt_galaxy_hoodie', 'shirt_hoodie_black'], pants: ['pants_purple', 'pants_galaxy'],
        face: ['face_star_eyes', 'face_smirk', 'face_cool'], hat: ['wizard'], back: ['cape_purple'], aura: ['aura_stars', 'aura_galaxy', 'aura_gold_sparkle'], P: { hat: 0.9, back: 0.5 } },
    cop: { hair: ['hair_buzz_*', 'hair_side_part_*'], shirt: ['shirt_police'], pants: ['pants_suit_black'], face: ['face_cool', 'face_angry', 'face_smile'],
        hat: ['cap_black', 'cap_blue'], glasses: ['sunglasses'], P: { hat: 0.7, glasses: 0.4 } },
    fireman: { hair: ['hair_buzz_*', 'hair_spiky_*'], shirt: ['shirt_firefighter'], pants: ['pants_cargo_green', 'pants_jeans_black'], face: ['face_grin', 'face_happy'],
        hat: ['hardhat'], P: { hat: 0.85 } },
    party: { hair: ['hair_afro_*', 'hair_curly_*', 'hair_pigtails_*', 'hair_mohawk_*'], shirt: ['shirt_rainbow', 'shirt_tiedye', 'shirt_hawaiian', 'shirt_sweater_xmas'],
        pants: ['pants_rainbow', 'pants_checkered', 'pants_plaid_red', 'pants_jeans_blue'], face: ['face_laugh', 'face_silly', 'face_derp', 'face_dizzy'],
        hat: ['party_hat', 'santa_hat', 'propeller_cap'], aura: ['aura_confetti', 'aura_music', 'aura_rainbow', 'aura_bubbles'], P: { hat: 0.6 } },
};
const WR_BOT_THEMES = ['pirate', 'knight', 'astronaut', 'cowboy', 'chef', 'wizard', 'cop', 'fireman', 'party'];
const WR_BOT_SKINS = [0xffdbb8, 0xf2c49b, 0xeab892, 0xd9a07a, 0xc68863, 0xa47152, 0x7c5c46, 0x5a3c2c];

// Эффект ауры: параметры стиля (px в осях персонажа: якорь у ног, y — вверх; life, size, rate, speed).
/** @type {Record<string, { rate: number, life: number[], size: number[], speed: number[] }>} */
const WR_AURA_STYLE = {
    rise: { rate: 13, life: [1, 1.6], size: [18, 28], speed: [40, 80] },
    orbit: { rate: 34, life: [0.55, 0.9], size: [14, 22], speed: [4, 12] },
    swirl: { rate: 40, life: [0.7, 1], size: [10, 18], speed: [20, 40] },
    fall: { rate: 7, life: [2.4, 3.2], size: [16, 26], speed: [30, 55] },
    burst: { rate: 4, life: [0.2, 0.38], size: [24, 40], speed: [150, 260] },
    pulse: { rate: 1.15, life: [0.95, 1], size: [210, 230], speed: [0, 0] },
};
// Текстуры частиц со своей «формой» цвета: обычное наложение (не аддитивное).
const WR_AURA_STD = /(flame|smoke_puff|heart|leaf|petal|dollar|butterfly|ghost|music_note|crown|confetti_sheet|snowflake|bubble)\.png$/;

/** @satisfies {Record<string, any>} */
const GameWardrobe = {
    isOpen: false,
    tab: 'acc',
    /** @type {string | null} выбранная карточка (примерка или надетая) */
    sel: null,
    /** @type {Record<string, string | null>} примерка по слотам (поверх надетого) */
    preview: {},
    _busy: false,
    _avVer: -1,
    _flashT: 0,
    _flashText: '',
    _land: true,
    /** @type {HTMLElement | null} */
    root: null,
    /** @type {HTMLElement | null} */
    stage: null,
    /** @type {HTMLElement | null} */
    panel: null,
    /** @type {HTMLElement | null} */
    grid: null,
    /** @type {HTMLElement | null} */
    tabsEl: null,
    /** @type {HTMLElement | null} */
    footEl: null,
    /** @type {HTMLElement | null} */
    balEl: null,
    /** @type {Map<string, HTMLElement>} */
    _cards: new Map(),
    /** @type {{ x: number, y: number, w: number, h: number }} область персонажа на экране (CSS px) */
    _stageRect: { x: 0, y: 0, w: 0, h: 0 },
    /** @type {{ id: number, x: number } | null} */
    _drag: null,
    /** @type {{ t: number, pos: BABYLON.Vector3, tgt: BABYLON.Vector3, az: number, turnTo: number | null, eye: BABYLON.Vector3, at: BABYLON.Vector3, fov: number } | null} */
    _cam: null,
    _prevFrozen: false,
    // Аура-эффекты: персонаж -> { id, h (handle ParticleFX), anchor, q, pending, special, base, phase }.
    /** @type {Map<Character, any>} */
    _auras: new Map(),
    /** @type {Set<Character>} */
    _auraBots: new Set(),
    _auraPickT: 0,
    /** @type {Map<string, { state: string, colored: boolean, hue: number, gray: BABYLON.DynamicTexture | null }>} */
    _texInfo: new Map(),

    // --- Сохранение ---------------------------------------------------------------------------

    // Стандартный набор по слотам (вещи default каталога).
    /** @returns {CosEquip} */
    defaults() {
        /** @type {CosEquip} */
        const e = { hat: null, glasses: null, back: null, hair: null, face: null, shirt: null, pants: null, aura: null };
        for (const it of this._items()) if (it.default && e[it.slot] == null) e[it.slot] = it.id;
        return e;
    },

    // Привести save.cos к виду { owned, equip, fresh } (старые сохранения — стандартный набор).
    migrate(s) {
        if (!s || typeof s !== 'object') return;
        const c = s.cos && typeof s.cos === 'object' ? s.cos : {};
        /** @type {string[]} */
        const owned = Array.isArray(c.owned) ? c.owned.filter(x => typeof x === 'string') : [];
        for (const it of this._items()) if (it.default && owned.indexOf(it.id) < 0) owned.push(it.id);
        const eq = c.equip && typeof c.equip === 'object' ? c.equip : {};
        const def = this.defaults();
        /** @type {any} */
        const equip = {};
        for (const slot of WR_SLOTS) {
            const v = eq[slot], it = Character.cosItem(v);
            if (it && it.slot === slot && owned.indexOf(v) >= 0) equip[slot] = v;
            else if (v === null && slot in eq && !WR_REQUIRED[slot]) equip[slot] = null;
            else equip[slot] = def[slot];
        }
        const fresh = Array.isArray(c.fresh) ? c.fresh.filter(id => typeof id === 'string' && owned.indexOf(id) >= 0) : [];
        s.cos = { owned: Array.from(new Set(owned)), equip, fresh };
    },

    /** @returns {{ owned: string[], equip: CosEquip, fresh: string[] }} */
    _cos() {
        const s = typeof Game !== 'undefined' ? Game.save : null;
        if (!s) return { owned: this._items().filter(i => i.default).map(i => i.id), equip: this.defaults(), fresh: [] };
        if (!s.cos || !Array.isArray(s.cos.owned) || !s.cos.equip || !Array.isArray(s.cos.fresh)) this.migrate(s);
        return s.cos;
    },

    /** @returns {CosItem[]} */
    _items() { return typeof COSMETICS !== 'undefined' && COSMETICS && Array.isArray(COSMETICS.items) ? COSMETICS.items : []; },

    // --- API ---------------------------------------------------------------------------------------

    owns(id) { return this._cos().owned.indexOf(id) >= 0; },

    // Выдать вещь (покупка, реклама, подарок). opts.equip — сразу надеть. -> true — вещь у игрока.
    give(id, opts) {
        const it = Character.cosItem(id);
        if (!it) return false;
        const c = this._cos();
        if (c.owned.indexOf(id) < 0) {
            c.owned.push(id);
            if (c.fresh.indexOf(id) < 0 && !this.isOpen) c.fresh.push(id);
        }
        const equip = !!(opts && opts.equip);
        if (equip) {
            c.equip[it.slot] = id;
            delete this.preview[it.slot];
            this._applyPlayer();
        }
        Game.saveSoon();
        this._syncBadge();
        if (this.isOpen) this._render();
        Game.emit('cosmetic', { id, equip });
        return true;
    },

    // Надеть свою вещь. -> false — нет такой или не куплена.
    equip(id) {
        const it = Character.cosItem(id);
        if (!it || !this.owns(id)) return false;
        this._cos().equip[it.slot] = id;
        delete this.preview[it.slot];
        this._applyPlayer();
        Game.saveSoon();
        if (this.isOpen) this._render();
        Game.emit('cosmetic', { id, equip: true });
        return true;
    },

    // Снять вещь слота (лицо, рубашку, штаны — нельзя). -> false — нельзя.
    unequip(slot) {
        if (WR_SLOTS.indexOf(slot) < 0 || WR_REQUIRED[slot]) return false;
        this._cos().equip[slot] = null;
        delete this.preview[slot];
        this._applyPlayer();
        Game.saveSoon();
        if (this.isOpen) this._render();
        return true;
    },

    // Внешность игрока по надетому (каталожный look).
    lookOfPlayer() {
        const e = this._cos().equip;
        return { skin: WR_SKIN, hat: e.hat, glasses: e.glasses, back: e.back, hair: e.hair, face: e.face, shirt: e.shirt, pants: e.pants, aura: e.aura };
    },

    // Надетое + примерка (пока окно открыто).
    _previewLook() {
        const l = /** @type {any} */ (this.lookOfPlayer());
        if (this.isOpen) for (const k in this.preview) l[k] = this.preview[k];
        return l;
    },

    _applyPlayer() {
        const p = Game.player;
        if (!p || p.disposed) return;
        p.setAppearance(this._previewLook());
        this._refreshAvatar();
    },

    // Кружок-аватар бейджа игрока — по надетому (не по примерке).
    _refreshAvatar() {
        const p = Game.player;
        if (!p) return;
        const av = Character.avatarFor(this.lookOfPlayer());
        if (av && av !== p.avatar) {
            p.avatar = av;
            if (typeof GameUI !== 'undefined' && typeof GameUI.refreshBadge === 'function') GameUI.refreshBadge(p);
        }
    },

    // --- Модуль ---------------------------------------------------------------------------------

    init(game) {
        void game;
        this._css();
        this._build();
        const ui = typeof GameUI !== 'undefined' ? GameUI : null;
        if (ui && typeof ui.addHudButton === 'function') {
            const b = ui.addHudButton({ id: 'wardrobe', icon: 'assets/ui/icon_wardrobe.png', text: Lang.t('wardrobe'), theme: 'purple', order: 5,
                onClick: () => { this.open(); } });
            const img = b && b.querySelector('img');
            if (img) img.addEventListener('error', () => { if (!/icon_shop/.test(img.src)) img.src = 'assets/ui/icon_shop.png'; }, { once: true });
        }
        Game.on('aura', (e) => { if (this.isOpen && e.char === Game.player) { this._renderBalance(); this._renderTags(); this._renderFoot(); } });
        Game.on('start', () => this._syncBtn());
        window.addEventListener('resize', () => { if (this.isOpen) this._layout(); });
        window.addEventListener('keydown', (e) => {
            if (e.code !== 'Escape' || !this.isOpen) return;
            const ui2 = typeof GameUI !== 'undefined' ? /** @type {any} */ (GameUI) : null;
            if (ui2 && ui2._modals && ui2._modals.length) return;   // сверху окно — Esc его
            this.close();
            if (ui2) ui2.adBreak();
        });
        this._refreshAvatar();
        this._syncBtn();
        this._syncBadge();
    },

    ready() {
        // Текстуры эффектов аур — разбор цвета заранее (тонировка: своя/серая).
        for (const it of this._items()) if (it.aura) this._texLoad(it.aura.tex);
        this._debug();
    },

    // Game.debug.wardrobe() — сводка; проверка пулов ботов (?debug).
    _debug() {
        const D = Game.debug;
        if (D && !D.wardrobe) {
            const known = new Set(this._items().map(i => i.id));
            for (const k in WR_BOT) for (const s in WR_BOT[k]) {
                if (!Array.isArray(WR_BOT[k][s]) || s === 'skin') continue;
                for (const p of WR_BOT[k][s]) if (p && !/\*$/.test(p) && !known.has(p)) console.warn('GameWardrobe: в пуле ботов ' + k + '.' + s + ' нет вещи ' + p);
            }
            D.wardrobe = () => JSON.stringify({ open: this.isOpen, tab: this.tab, sel: this.sel, preview: this.preview, cos: this._cos(),
                auras: [...this._auras.keys()].map(c => c.name + ':' + (c.look && c.look.aura)) });
        }
    },

    onZone(zone) {
        if (zone !== 'lobby' && this.isOpen) this.close();
        this._syncBtn();
    },

    update(dt, realDt) {
        const rdt = Math.min(0.1, realDt == null ? dt : realDt);
        if (this.isOpen) {
            this._camUpdate(rdt);
            if (this._flashT > 0) { this._flashT -= rdt; if (this._flashT <= 0) this._renderFoot(); }
        }
        this._auraSync(rdt);
        if (Game.debug && !Game.debug.wardrobe) this._debug();
        // Картинки аватаров догрузились — перерисовать кружки игрока и ботов.
        if (Character.avatarVer !== this._avVer) {
            this._avVer = Character.avatarVer;
            this._refreshAvatar();
            if (typeof GameBots !== 'undefined') /** @type {any} */ (GameBots)._avDirty = true;
        }
    },

    _syncBtn() {
        const ui = typeof GameUI !== 'undefined' ? GameUI : null;
        if (ui && typeof ui.showHudButton === 'function') ui.showHudButton('wardrobe', Game.zone === 'lobby');
    },

    _syncBadge() {
        const ui = typeof GameUI !== 'undefined' ? GameUI : null;
        if (!ui || typeof ui.setHudBadge !== 'function') return;
        const n = this._cos().fresh.length;
        ui.setHudBadge('wardrobe', n > 0 ? n : null);
    },

    // --- Окно -----------------------------------------------------------------------------------

    // Открыть гардероб (только в лобби, после «ИГРАТЬ»). tab — id вкладки. -> true — открыт.
    open(tab) {
        if (tab && COSMETICS.tabs.some(t => t.id === tab)) this.tab = tab;
        if (this.isOpen) { this._setTab(this.tab); return true; }
        const p = Game.player;
        if (!this.root || !p || !Game.started || Game.zone !== 'lobby' || Game.transitioning || !p.onGround ||
            p.state === 'dead' || p.state === 'falling' || p.state === 'ragdoll') return false;
        this.isOpen = true;
        this.preview = {};
        this.sel = null;
        this._busy = false;
        this._flashT = 0;
        this._prevFrozen = GamePlayer.frozen;
        GamePlayer.frozen = true;
        GameInput.reset();
        GameInput.setVisible(false);
        const ui = typeof GameUI !== 'undefined' ? GameUI : null;
        if (ui) { ui.showHud(false); if (ui.badges) ui.badges.style.visibility = 'hidden'; ui.sfx('assets/sounds/ui_open.mp3', 1); }
        this.root.classList.remove('gw-off');
        document.body.classList.add('gw-open');
        this._layout();
        this._setTab(this.tab);
        this._camStart();
        return true;
    },

    close() {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.preview = {};
        this.sel = null;
        this._drag = null;
        if (this.root) this.root.classList.add('gw-off');
        document.body.classList.remove('gw-open');
        GamePlayer.frozen = this._prevFrozen;
        const ui = typeof GameUI !== 'undefined' ? GameUI : null;
        if (ui) { if (Game.started) ui.showHud(true); if (ui.badges) ui.badges.style.visibility = ''; }
        if (Game.started) { GameInput.reset(); GameInput.setVisible(true); }
        this._camEnd();
        this._applyPlayer();
        const c = this._cos();
        if (c.fresh.length) { c.fresh = []; Game.saveSoon(); }
        this._syncBadge();
    },

    // Выбрать вещь (вкладка + примерка) — для подарка и отладки. -> false — нет вещи/окно закрыто.
    select(id) {
        const it = Character.cosItem(id);
        if (!it || (!this.isOpen && !this.open(it.tab))) return false;
        if (this.tab !== it.tab) this._setTab(it.tab);
        if (this.sel !== id) this._pick(id);
        return true;
    },

    _name(it) { return it ? (Lang.code === 'ru' ? it.ru : it.en || it.ru) : ''; },

    _equipped(slot) { return /** @type {any} */ (this._cos().equip)[slot] || null; },

    // Уровень вещи 0 (стандартная) … 5, эксклюзив — 6.
    _tier(it) {
        if (it.default) return 0;
        if (it.exclusive) return 6;
        if (it.ads) return Math.min(5, it.ads);
        return WR_TIER[it.price] || Math.max(1, Math.min(5, Math.ceil((it.price || 0) / 180)));
    },

    _setTab(tab) {
        this.tab = tab;
        this.sel = null;
        for (const b of /** @type {NodeListOf<HTMLElement>} */ (this.tabsEl.querySelectorAll('.gw-tab'))) b.classList.toggle('gw-act', b.dataset.tab === tab);
        this._buildGrid();
        this._render();
        this.grid.scrollTop = 0;
    },

    // Тап по карточке: примерить; повторный тап по примерке — убрать её.
    _pick(id) {
        const it = Character.cosItem(id);
        if (!it) return;
        const worn = this._equipped(it.slot) === id;
        if (this.sel === id && !worn) {
            delete this.preview[it.slot];
            this.sel = null;
        } else {
            this.sel = id;
            if (worn) delete this.preview[it.slot]; else this.preview[it.slot] = id;
        }
        this._flashT = 0;
        this._applyPlayer();
        this._render();
    },

    async _watchAd(it) {
        if (this._busy) return;
        this._busy = true;
        this._renderFoot();
        /** @type {any} */
        let r = null;
        try { r = await Game.adUnlock('cos_' + it.id, it.ads || 1); } catch (e) { r = null; }
        this._busy = false;
        if (r && r.done) this._granted(it);
        else if (r && r.ok) this._flash(Lang.t('wrAdLeft', { n: Math.max(0, r.need - r.views) }));
        else this._flash(Lang.t('wrAdFail'));
        if (this.isOpen) this._render();
    },

    _buy(it) {
        if (!(it.price > 0) || !Game.spendAura(it.price)) { this._flash(Lang.t('wrNoAura')); this._render(); return; }
        if (typeof GameUI !== 'undefined') GameUI.sfx('assets/sounds/coin.mp3', 1);
        this._granted(it);
        Game.saveNow();
    },

    // Вещь получена (покупка/реклама): выдать, надеть, эффект.
    _granted(it) {
        this.give(it.id, { equip: true });
        this.sel = it.id;
        if (typeof GameUI !== 'undefined') GameUI.sfx('assets/sounds/unlock.mp3', 1);
        if (typeof GameFX !== 'undefined' && Game.player) GameFX.play('gloveEquip', Game.player, { follow: Game.player, height: 120, force: true });
        this._flash(Lang.t('wrGot', { name: this._name(it) }));
        this._render();
    },

    _wear(it) {
        if (this.equip(it.id) && typeof GameFX !== 'undefined' && Game.player) GameFX.play('gloveEquip', Game.player, { follow: Game.player, height: 120, force: true });
    },

    _takeOff(it) {
        if (!this.unequip(it.slot)) { this._flash(Lang.t('wrKeep')); return; }
        this.sel = null;
        this._render();
    },

    _flash(text) {
        this._flashText = text;
        this._flashT = WR_FLASH;
        this._renderFoot();
    },

    // --- Разметка -------------------------------------------------------------------------------

    _css() {
        const st = document.createElement('style');
        st.textContent = `
#gw-root{position:fixed;inset:0;z-index:30;pointer-events:none;font-family:GameFont,system-ui,sans-serif;font-weight:900;color:#fff;user-select:none;-webkit-user-select:none}
#gw-root.gw-off{display:none}
body.gw-open #gt-card{display:none!important}
.gw-stage{position:absolute;pointer-events:auto;touch-action:none;cursor:grab;-webkit-tap-highlight-color:transparent}
.gw-stage:active{cursor:grabbing}
.gw-panel{position:absolute;display:flex;flex-direction:column;box-sizing:border-box;pointer-events:auto;border-radius:20px;border:4px solid #14202c;background:#1f2c3b;
 box-shadow:0 7px 0 rgba(0,0,0,.3),0 16px 30px rgba(0,0,0,.3);overflow:hidden;animation:gw-in .22s ease-out}
@keyframes gw-in{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
#gw-root.gw-land .gw-panel{top:calc(10px + env(safe-area-inset-top));bottom:calc(10px + env(safe-area-inset-bottom));right:calc(10px + env(safe-area-inset-right));width:var(--gw-pw)}
#gw-root.gw-land .gw-stage{left:0;top:0;bottom:0;right:calc(var(--gw-pw) + 20px + env(safe-area-inset-right))}
#gw-root.gw-port .gw-panel{left:calc(6px + env(safe-area-inset-left));right:calc(6px + env(safe-area-inset-right));bottom:calc(6px + env(safe-area-inset-bottom));height:var(--gw-ph)}
#gw-root.gw-port .gw-stage{left:0;right:0;top:0;bottom:calc(var(--gw-ph) + 6px + env(safe-area-inset-bottom))}
.gw-head{flex:none;display:flex;align-items:center;gap:8px;min-height:50px;padding:4px 8px 4px 14px;box-sizing:border-box;background:linear-gradient(#b67aff,#8040e0);border-bottom:4px solid #14202c}
.gw-title{flex:1;min-width:0;font-size:25px;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
 text-shadow:-2px -2px 0 #2a0f55,2px -2px 0 #2a0f55,-2px 2px 0 #2a0f55,2px 2px 0 #2a0f55,0 3px 0 rgba(0,0,0,.35)}
.gw-bal{flex:none;display:flex;align-items:center;gap:4px;height:36px;padding:0 12px 0 3px;box-sizing:border-box;border-radius:20px;background:rgba(10,20,40,.45);border:2px solid rgba(255,255,255,.35);
 font-size:20px;text-shadow:0 2px 0 rgba(0,0,0,.35)}
.gw-bal img{width:30px;height:30px}
.gw-x{flex:none;width:40px;height:40px;padding:0;border-radius:50%;border:3px solid #14202c;background:linear-gradient(#ff5050,#d01f1f);color:#fff;cursor:pointer;
 font:900 22px/1 GameFont,system-ui,sans-serif;text-shadow:0 2px 0 rgba(0,0,0,.35);box-shadow:0 2px 0 rgba(0,0,0,.3);-webkit-tap-highlight-color:transparent}
.gw-x:active{transform:scale(.92)}
.gw-tabs{flex:none;display:flex;gap:4px;padding:6px 6px 0;background:#18222e}
.gw-tab{flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;height:58px;padding:3px 2px;box-sizing:border-box;
 border:3px solid #10161d;border-bottom:0;border-radius:12px 12px 0 0;background:linear-gradient(#3b4553,#2a313b);color:#c9d6e3;cursor:pointer;
 font:900 12px/1 GameFont,system-ui,sans-serif;-webkit-tap-highlight-color:transparent}
.gw-tab img{width:32px;height:32px;object-fit:contain;filter:drop-shadow(0 2px 2px rgba(0,0,0,.35))}
.gw-tab .gw-tl{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gw-tab.gw-act{background:linear-gradient(#ffd75a,#f3a312);color:#5a3500;border-color:#6b3d00}
.gw-tab.gw-noimg img{display:none}
.gw-tab.gw-noimg .gw-tl{font-size:13px;white-space:normal;line-height:1.05;text-align:center}
.gw-grid{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;touch-action:pan-y;display:grid;
 grid-template-columns:repeat(auto-fill,minmax(var(--gw-cw,94px),1fr));align-content:start;gap:8px;padding:8px;background:#18222e;border-top:3px solid #10161d}
.gw-card{position:relative;display:flex;flex-direction:column;align-items:center;gap:3px;min-width:0;padding:6px 4px;border-radius:13px;border:3px solid #10161d;
 background:linear-gradient(#3b4553,#2a313b);color:#fff;font:inherit;cursor:pointer;box-shadow:inset 0 2px 0 rgba(255,255,255,.08),0 3px 0 rgba(0,0,0,.3);-webkit-tap-highlight-color:transparent}
.gw-card:active{transform:translateY(2px)}
.gw-card.gw-on{background:linear-gradient(#2f7a3a,#215a29)}
.gw-card.gw-try{border-color:#7fd0ff}
.gw-card.gw-sel{border-color:#ffd75a;box-shadow:0 0 0 2px #ffd75a,0 3px 0 rgba(0,0,0,.3)}
.gw-card.gw-lock .gw-ic{opacity:.85}
.gw-ic{position:relative;width:var(--gw-iw,64px);height:var(--gw-iw,64px);display:flex;align-items:center;justify-content:center;border-radius:10px;background:rgba(255,255,255,.07)}
.gw-ic img{max-width:100%;max-height:100%;object-fit:contain;filter:drop-shadow(0 2px 2px rgba(0,0,0,.35))}
.gw-sw{width:70%;height:70%;border-radius:50%;border:3px solid rgba(255,255,255,.85);box-shadow:0 2px 3px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;
 font-size:20px;color:#fff;text-shadow:0 2px 0 rgba(0,0,0,.45)}
.gw-nm{width:100%;font-size:12px;line-height:1.12;height:2.24em;overflow:hidden;text-align:center;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
 font-weight:800;color:#e8eef5;overflow-wrap:anywhere}
.gw-tag{display:flex;align-items:center;justify-content:center;gap:3px;max-width:100%;min-height:19px;font-size:14px;line-height:1.05;text-align:center;text-shadow:0 2px 0 rgba(0,0,0,.35)}
.gw-tag img{width:19px;height:19px;flex:none}
.gw-t-on{color:#9dff8a}
.gw-t-own{color:#c9d6e3}
.gw-t-gift{color:#ffd75a;font-size:11px}
.gw-t-ad{color:#e3c8ff}
.gw-t-aura{color:#ffc2cf}
.gw-t-poor{color:#ff9a9a}
.gw-lk{position:absolute;right:3px;top:3px;width:22px;height:22px;filter:drop-shadow(0 1px 1px rgba(0,0,0,.5))}
.gw-new{position:absolute;left:3px;top:3px;padding:2px 5px;border-radius:8px;border:2px solid #fff;background:#ff2d3a;font-size:10px;line-height:1}
.gw-foot{flex:none;display:flex;align-items:center;gap:10px;min-height:64px;padding:8px 10px;box-sizing:border-box;background:#1f2c3b;border-top:3px solid #10161d}
.gw-info{flex:1;min-width:0}
.gw-iname{font-size:18px;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 2px 0 rgba(0,0,0,.35)}
.gw-inote{margin-top:2px;font-size:13px;font-weight:800;line-height:1.15;color:#c9d6e3;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.gw-inote.gw-warn{color:#ffd166}
.gw-acts{flex:none;display:flex;gap:8px;max-width:62%}
.gw-acts .gu-b,.gw-acts .gw-b{min-width:0;max-width:100%;padding:11px 14px;font-size:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gw-b{border-radius:14px;border:3px solid #14202c;color:#fff;font:900 17px/1.1 GameFont,system-ui,sans-serif;background:linear-gradient(#4fe356,#25a92e);cursor:pointer}
.gw-b[disabled]{filter:grayscale(.85) brightness(.8)}
#gw-root.gw-big{--gw-cw:108px;--gw-iw:76px}
#gw-root.gw-big .gw-nm{font-size:13px}
@media (max-height:460px){.gw-head{min-height:42px;padding:2px 6px 2px 12px}.gw-title{font-size:20px}.gw-bal{height:32px;font-size:17px}.gw-bal img{width:26px;height:26px}
 .gw-x{width:34px;height:34px;font-size:18px}.gw-tab{height:40px}.gw-tab .gw-tl{display:none}.gw-tab.gw-noimg .gw-tl{display:block;font-size:11px}.gw-tab img{width:28px;height:28px}
 #gw-root{--gw-iw:52px;--gw-cw:86px}.gw-foot{min-height:54px;padding:5px 8px}.gw-iname{font-size:16px}.gw-acts .gu-b,.gw-acts .gw-b{padding:8px 12px;font-size:15px}}
@media (max-width:380px){.gw-title{font-size:21px}.gw-acts .gu-b,.gw-acts .gw-b{padding:10px 10px;font-size:15px}.gw-iname{font-size:16px}#gw-root{--gw-cw:88px;--gw-iw:58px}}
`;
        document.head.appendChild(st);
    },

    _build() {
        const root = this.root = document.createElement('div');
        root.id = 'gw-root';
        root.className = 'gw-off gw-land';
        root.innerHTML = '<div class="gw-stage"></div><div class="gw-panel"><div class="gw-head"><div class="gw-title"></div>' +
            '<div class="gw-bal"><img src="assets/ui/icon_aura.png" alt=""><span>0</span></div><button class="gw-x" type="button" aria-label="close">✕</button></div>' +
            '<div class="gw-tabs"></div><div class="gw-grid"></div><div class="gw-foot"></div></div>';
        this.stage = /** @type {HTMLElement} */ (root.querySelector('.gw-stage'));
        this.panel = /** @type {HTMLElement} */ (root.querySelector('.gw-panel'));
        this.grid = /** @type {HTMLElement} */ (root.querySelector('.gw-grid'));
        this.tabsEl = /** @type {HTMLElement} */ (root.querySelector('.gw-tabs'));
        this.footEl = /** @type {HTMLElement} */ (root.querySelector('.gw-foot'));
        this.balEl = /** @type {HTMLElement} */ (root.querySelector('.gw-bal span'));
        root.querySelector('.gw-title').textContent = Lang.t('wardrobe');
        root.querySelector('.gw-x').addEventListener('click', (e) => { e.stopPropagation(); this.close(); if (typeof GameUI !== 'undefined') { GameUI.click(); GameUI.adBreak(); } });
        for (const t of COSMETICS.tabs) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'gw-tab';
            b.dataset.tab = t.id;
            b.title = Lang.code === 'ru' ? t.ru : t.en;
            b.innerHTML = '<img alt=""><span class="gw-tl"></span>';
            const img = /** @type {HTMLImageElement} */ (b.querySelector('img'));
            img.addEventListener('error', () => b.classList.add('gw-noimg'), { once: true });
            img.src = t.icon;
            b.querySelector('.gw-tl').textContent = b.title;
            b.addEventListener('click', () => { if (typeof GameUI !== 'undefined') GameUI.click(); if (this.tab !== t.id) this._setTab(t.id); });
            this.tabsEl.appendChild(b);
        }
        // Поворот персонажа перетаскиванием по сцене.
        const st = this.stage;
        st.addEventListener('pointerdown', (e) => {
            this._drag = { id: e.pointerId, x: e.clientX };
            if (this._cam) this._cam.turnTo = null;
            try { st.setPointerCapture(e.pointerId); } catch (err) { /* синтетическое событие */ }
        });
        st.addEventListener('pointermove', (e) => {
            const d = this._drag, p = Game.player;
            if (!d || d.id !== e.pointerId || !p) return;
            p.heading -= (e.clientX - d.x) * WR_TURN;
            d.x = e.clientX;
        });
        const up = (e) => { if (this._drag && this._drag.id === e.pointerId) this._drag = null; };
        st.addEventListener('pointerup', up);
        st.addEventListener('pointercancel', up);
        st.addEventListener('contextmenu', (e) => e.preventDefault());
        document.body.appendChild(root);
    },

    // Раскладка по форме экрана: альбом — панель справа; портрет — снизу (~55% высоты).
    _layout() {
        const root = this.root;
        if (!root) return;
        const W = VIEW.w, H = VIEW.h;
        const land = W >= H;
        this._land = land;
        root.classList.toggle('gw-land', land);
        root.classList.toggle('gw-port', !land);
        const pw = Math.round(Math.max(300, Math.min(640, W * 0.44, W - 240)));
        const ph = Math.round(Math.max(Math.min(280, H * 0.6), Math.min(H * 0.55, H - 170)));
        root.style.setProperty('--gw-pw', pw + 'px');
        root.style.setProperty('--gw-ph', ph + 'px');
        root.classList.toggle('gw-big', (land ? pw : W) >= 560 && H >= 700);
        const r = this.stage.getBoundingClientRect();
        this._stageRect = { x: r.left - VIEW.x, y: r.top - VIEW.y, w: Math.max(80, r.width), h: Math.max(80, r.height) };
    },

    _buildGrid() {
        const grid = this.grid;
        grid.textContent = '';
        this._cards.clear();
        const c = this._cos();
        const slotOrder = { hat: 0, glasses: 1, back: 2 };
        const list = this._items().map((it, i) => ({ it, i })).filter(x => x.it.tab === this.tab);
        // Свои — первыми (стандартные раньше), потом по цене, эксклюзивы — в конце; аксессуары — по слотам.
        list.sort((a, b) => {
            const sa = slotOrder[a.it.slot] || 0, sb = slotOrder[b.it.slot] || 0;
            if (sa !== sb) return sa - sb;
            const oa = c.owned.indexOf(a.it.id) >= 0 ? 0 : 1, ob = c.owned.indexOf(b.it.id) >= 0 ? 0 : 1;
            if (oa !== ob) return oa - ob;
            const ta = this._tier(a.it), tb = this._tier(b.it);
            return ta !== tb ? ta - tb : a.i - b.i;
        });
        for (const { it } of list) {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'gw-card';
            card.dataset.id = it.id;
            card.innerHTML = '<div class="gw-ic"></div><div class="gw-nm"></div><div class="gw-tag"></div>';
            card.querySelector('.gw-nm').textContent = this._name(it);
            this._icon(/** @type {HTMLElement} */ (card.querySelector('.gw-ic')), it);
            card.addEventListener('click', () => { if (typeof GameUI !== 'undefined') GameUI.click(); this._pick(it.id); });
            grid.appendChild(card);
            this._cards.set(it.id, card);
        }
    },

    // Иконка вещи; нет файла — лицо (текстура) или кружок цвета вещи с буквой.
    _icon(box, it) {
        const img = document.createElement('img');
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        let tried = false;
        img.addEventListener('error', () => {
            if (!tried && it.texture && it.slot === 'face') { tried = true; img.src = it.texture; return; }
            img.remove();
            const sw = document.createElement('div');
            sw.className = 'gw-sw';
            const col = it.tone != null ? it.tone : it.color != null ? it.color : it.aura ? it.aura.color : 0x8899aa;
            sw.style.background = '#' + Character.hex(col);
            sw.textContent = (this._name(it) || '?').charAt(0).toUpperCase();
            box.appendChild(sw);
        });
        img.src = it.icon;
        box.appendChild(img);
    },

    _render() {
        if (!this.isOpen) return;
        this._renderBalance();
        this._renderTags();
        this._renderFoot();
    },

    _renderBalance() { if (this.balEl) this.balEl.textContent = String(Game.player ? Game.player.aura : 0); },

    // Состояние карточек: надето / есть / примерка / выбрана / ценник.
    _renderTags() {
        const c = this._cos(), aura = Game.player ? Game.player.aura : 0;
        for (const [id, card] of this._cards) {
            const it = Character.cosItem(id);
            if (!it) continue;
            const owned = c.owned.indexOf(id) >= 0, worn = this._equipped(it.slot) === id;
            const tryOn = this.preview[it.slot] === id;
            card.classList.toggle('gw-on', worn);
            card.classList.toggle('gw-try', tryOn && !worn);
            card.classList.toggle('gw-sel', this.sel === id);
            card.classList.toggle('gw-lock', !owned && !!it.exclusive);
            let html, cls;
            if (worn) { html = '<img src="assets/ui/icon_check.png" alt="">' + this._esc(Lang.t('wrWorn')); cls = 'gw-t-on'; }
            else if (owned) { html = this._esc(Lang.t('wrOwned')); cls = 'gw-t-own'; }
            else if (it.exclusive) { html = this._esc(Lang.t('wrGift')); cls = 'gw-t-gift'; }
            else if (it.ads) { html = '<img src="assets/ui/icon_video.png" alt="">' + Game.adViews('cos_' + id) + '/' + it.ads; cls = 'gw-t-ad'; }
            else { html = '<img src="assets/ui/icon_aura.png" alt="">' + (it.price || 0); cls = aura >= (it.price || 0) ? 'gw-t-aura' : 'gw-t-poor'; }
            const tag = /** @type {HTMLElement} */ (card.querySelector('.gw-tag'));
            const key = cls + '|' + html;
            if (tag.dataset.k !== key) { tag.dataset.k = key; tag.className = 'gw-tag ' + cls; tag.innerHTML = html; }
            const lockOn = !owned && !!it.exclusive;
            let lk = card.querySelector('.gw-lk');
            if (lockOn && !lk) { lk = document.createElement('img'); lk.className = 'gw-lk'; /** @type {HTMLImageElement} */ (lk).src = 'assets/ui/icon_lock.png'; card.appendChild(lk); }
            else if (!lockOn && lk) lk.remove();
            const isNew = c.fresh.indexOf(id) >= 0;
            let nw = card.querySelector('.gw-new');
            if (isNew && !nw) { nw = document.createElement('span'); nw.className = 'gw-new'; nw.textContent = Lang.t('wrNew'); card.appendChild(nw); }
            else if (!isNew && nw) nw.remove();
        }
    },

    _esc(s) { return String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); },

    // Подвал: название выбранной вещи, подсказка/статус и кнопка действия.
    _renderFoot() {
        const foot = this.footEl;
        if (!foot || !this.isOpen) return;
        const it = Character.cosItem(this.sel);
        foot.textContent = '';
        const info = document.createElement('div');
        info.className = 'gw-info';
        info.innerHTML = '<div class="gw-iname"></div><div class="gw-inote"></div>';
        const nameEl = /** @type {HTMLElement} */ (info.querySelector('.gw-iname')), note = /** @type {HTMLElement} */ (info.querySelector('.gw-inote'));
        const acts = document.createElement('div');
        acts.className = 'gw-acts';
        foot.append(info, acts);
        const btn = (text, kind, fn, disabled) => {
            const b = typeof GameUI !== 'undefined' ? GameUI.button(text, kind, fn) : (() => {
                const x = document.createElement('button'); x.type = 'button'; x.className = 'gw-b'; x.textContent = text; x.addEventListener('click', fn); return x;
            })();
            if (disabled) b.disabled = true;
            acts.appendChild(b);
            return b;
        };
        let noteText = '';
        if (!it) {
            nameEl.textContent = Lang.t('wardrobe');
            noteText = Lang.t('wrHint');
        } else {
            nameEl.textContent = this._name(it);
            const slot = Lang.t('wrSlot_' + it.slot);
            const worn = this._equipped(it.slot) === it.id, owned = this.owns(it.id);
            if (worn) {
                noteText = slot + ' · ' + Lang.t('wrWorn');
                if (!WR_REQUIRED[it.slot]) btn(Lang.t('wrTakeOff'), 'gray', () => this._takeOff(it));
            } else if (owned) {
                noteText = slot + ' · ' + Lang.t('wrTry');
                btn(Lang.t('wrWear'), 'green', () => this._wear(it));
            } else if (it.exclusive) {
                noteText = Lang.t('wrGiftNote');
                btn(Lang.t('wrGift'), 'gray', null, true);
            } else if (it.ads) {
                noteText = slot + ' · ' + Lang.t('wrTry');
                const k = Game.adViews('cos_' + it.id);
                btn(this._busy ? Lang.t('wrAdBusy') : Lang.t('wrAd', { k, n: it.ads }), 'ad', () => { this._watchAd(it); }, this._busy);
            } else {
                const aura = Game.player ? Game.player.aura : 0, price = it.price || 0;
                if (aura >= price) {
                    noteText = slot + ' · ' + Lang.t('wrTry');
                    btn(Lang.t('wrBuy', { n: price }), 'gold', () => this._buy(it));
                } else {
                    noteText = Lang.t('wrNeed', { n: price - aura });
                    btn(Lang.t('wrNoAura'), 'gray', null, true);
                }
            }
        }
        const warn = this._flashT > 0 && !!this._flashText;
        note.textContent = warn ? this._flashText : noteText;
        note.classList.toggle('gw-warn', warn);
        if (!acts.childNodes.length) acts.remove();
    },

    // --- Камера -----------------------------------------------------------------------------------
    // Спереди-сбоку (WR_CAM_YAW) крупно; персонаж — в центре своей области экрана (слева / сверху от
    // панели). Направление камеры фиксируется при открытии: перетаскивание крутит персонажа.
    // Камера с этой стороны упирается в препятствие — персонаж разворачивается к свободной стороне.

    _camStart() {
        const cam = GameCamera.cam, p = Game.player;
        if (!cam || !p) { this._cam = null; return; }
        let turnTo = null, az = p.heading + WR_CAM_YAW;
        const D = this._camDist();
        const free = (a) => {
            const ex = p.x + Math.cos(a) * D, ey = p.y + Math.sin(a) * D;
            return GameCamera._occlusion(p.x, p.y, p.h + 120, ex, ey, p.h + 120 + D * Math.sin(WR_CAM_PITCH)) > 0.97;
        };
        if (!free(az)) {
            for (const d of [0.7, -0.7, 1.4, -1.4, 2.1, -2.1, Math.PI]) {
                if (free(az + d)) { turnTo = p.heading + d; az += d; break; }
            }
        }
        this._cam = { t: 0, pos: cam.position.clone(), tgt: cam.getTarget().clone(), az, turnTo, eye: cam.position.clone(), at: cam.getTarget().clone(), fov: cam.fov };
    },

    // Дистанция камеры: персонаж (≈ 250 px с шапкой, 150–240 px в ширину) занимает WR_CAM_FILL области.
    _camDist() {
        const cam = GameCamera.cam;
        const W = VIEW.w, H = VIEW.h, R = this._stageRect;
        const tv = Math.tan(WR_CAM_FOV / 2), th = tv * W / H;
        const nh = (R.h / H) * 2, nw = (R.w / W) * 2;
        const l = this._previewLook();
        const HC = l.hat ? 255 : 232, WC = l.back ? 230 : 150;
        const D = Math.max(HC / (WR_CAM_FILL * nh * tv), WC / (WR_CAM_FILL * nw * th));
        return Math.max(170, Math.min(1500, D));
    },

    _camUpdate(rdt) {
        const C0 = this._cam, cam = GameCamera.cam, p = Game.player;
        if (!C0 || !cam || !p) return;
        if (C0.turnTo != null) {
            p.heading = Character.turn(p.heading, C0.turnTo, rdt * 5);
            if (Math.abs(p.heading - C0.turnTo) < 0.01) C0.turnTo = null;
        }
        const V = BABYLON.Vector3;
        const W = VIEW.w, H = VIEW.h, R = this._stageRect;
        const tv = Math.tan(WR_CAM_FOV / 2), th = tv * W / H;
        const ncx = ((R.x + R.w / 2) / W) * 2 - 1, ncy = 1 - ((R.y + R.h / 2) / H) * 2;
        const D = this._camDist();
        const l = this._previewLook();
        const C = new V(p.x, p.h + (l.hat ? 124 : 112), p.y);
        const cp = Math.cos(WR_CAM_PITCH), sp = Math.sin(WR_CAM_PITCH);
        const eye = new V(C.x + Math.cos(C0.az) * D * cp, C.y + D * sp, C.z + Math.sin(C0.az) * D * cp);
        const d = C.subtract(eye).normalize();
        const up = new V(0, 1, 0);
        // Правая рука экрана: сцена правосторонняя — forward × up.
        const right = V.Cross(d, up).normalize();
        const sup = V.Cross(right, d).normalize();
        const at = C.subtract(right.scale(ncx * D * th)).subtract(sup.scale(ncy * D * tv));
        eye.addInPlace(at.subtract(C));
        C0.t = Math.min(WR_CAM_BLEND, C0.t + rdt);
        const u = Character.ease(C0.t / WR_CAM_BLEND);
        V.LerpToRef(C0.pos, eye, u, C0.eye);
        V.LerpToRef(C0.tgt, at, u, C0.at);
        cam.fov = C0.fov + (WR_CAM_FOV - C0.fov) * u;
        cam.position.copyFrom(C0.eye);
        cam.setTarget(C0.at);
    },

    // Вернуть камеру GameCamera: плавно за спину игрока.
    _camEnd() {
        const C0 = this._cam, cam = GameCamera.cam, p = Game.player;
        this._cam = null;
        if (!C0 || !cam || !p) return;
        GameCamera._from = { pos: cam.position.clone(), tgt: C0.at.clone() };
        GameCamera._blendDur = GameCamera._blendT = WR_CAM_BLEND + 0.1;
        GameCamera.mode = 'follow';
        GameCamera.az = p.heading;
        GameCamera.tx = p.x; GameCamera.ty = p.y; GameCamera.th = p.h + GameCfg.camLookH;
        GameCamera._applyFov();
    },

    // --- Боты --------------------------------------------------------------------------------------

    // Каталожная внешность бота по архетипу GameBots._look и ауре (дорогие вещи — у богатых).
    botLook(aura, arch, kind) {
        void kind;
        const a = Math.max(0, aura || 0);
        let key = arch;
        if (!WR_BOT[key]) key = arch === 'random' && Math.random() < 0.7 ? botsPickWR(WR_BOT_THEMES) : '';
        const pool = key ? WR_BOT[key] : null;
        const maxT = a < 30 ? 1 : a < 120 ? 2 : a < 350 ? 3 : a < 800 ? 4 : 5;
        const rich = a >= 400;
        const items = this._items();
        const P = (pool && pool.P) || {};
        const expand = (pats) => {
            /** @type {Array<CosItem | null>} */
            const out = [];
            for (const p of pats || []) {
                if (p === null) { out.push(null); continue; }
                if (/\*$/.test(p)) { const pre = p.slice(0, -1); for (const it of items) if (it.id.indexOf(pre) === 0) out.push(it); }
                else { const it = Character.cosItem(p); if (it) out.push(it); }
            }
            return out;
        };
        // Вещь слота из пула: уровень ≤ maxT (эксклюзив — у очень богатых), богатые тянутся к дорогому.
        const pick = (slot) => {
            let list = pool && pool[slot] ? expand(pool[slot]) : items.filter(it => it.slot === slot);
            list = list.filter(it => !it || it.slot === slot);
            if (!list.length) return null;
            const ok = list.filter(it => !it || (it.exclusive ? a >= 1500 && Math.random() < 0.25 : this._tier(it) <= maxT));
            const from = ok.length ? ok : list.filter(it => !it || !it.exclusive).sort((x, y) => this._tier(x) - this._tier(y)).slice(0, 2);
            if (!from.length) return null;
            let sum = 0;
            const w = from.map(it => { const v = it ? 1 + (rich ? this._tier(it) * 0.7 : 0) : 1; sum += v; return v; });
            let r = Math.random() * sum;
            for (let i = 0; i < from.length; i++) { r -= w[i]; if (r <= 0) return from[i]; }
            return from[from.length - 1];
        };
        const chance = (slot, def) => Math.random() < Math.min(0.95, (P[slot] != null ? P[slot] : def) * (rich ? 1.25 : 1));
        const look = { skin: botsPickWR(pool && pool.skin ? pool.skin : WR_BOT_SKINS), hair: null, face: null, shirt: null, pants: null, hat: null, glasses: null, back: null, aura: null };
        const id = (it) => (it ? it.id : null);
        look.shirt = id(pick('shirt')) || 'shirt_starter';
        look.pants = id(pick('pants')) || 'pants_jeans_black';
        look.face = id(pick('face')) || 'face_smile';
        look.hair = id(pick('hair'));
        if (chance('hat', pool ? 0 : 0.3)) look.hat = id(pick('hat'));
        if (chance('glasses', pool ? 0 : 0.12)) look.glasses = id(pick('glasses'));
        if (chance('back', pool ? 0 : 0.15)) look.back = id(pick('back'));
        // Эффект ауры — только у богатых (показ ограничен WR_AURA_BOTS ближайшими).
        if (a >= WR_AURA_RICH && Math.random() < (P.aura != null ? P.aura : 0.25) * Math.min(1.3, a / 1200)) {
            const ap = pool && pool.aura ? pool : null;
            const list = (ap ? expand(ap.aura) : items.filter(it => it.slot === 'aura')).filter(it => it && !it.exclusive && this._tier(it) <= maxT);
            if (list.length) look.aura = botsPickWR(list).id;
        }
        // Шапка на объёмной причёске: чаще снять шапку, иначе — короткая стрижка.
        const hat = Character.cosItem(look.hat), hair = Character.cosItem(look.hair);
        if (Character.hatHidesHair(hat, hair)) {
            if (Math.random() < 0.6) look.hat = null;
            else look.hair = botsPickWR(['hair_buzz_brown', 'hair_buzz_black', 'hair_side_part_brown', 'hair_side_part_black']);
        }
        return look;
    },

    // --- Эффект ауры -----------------------------------------------------------------------------

    _fxMgr() {
        if (typeof GameFX !== 'undefined' && GameFX.ps) return GameFX.ps;
        return Game.app && Game.app.fx ? Game.app.fx : null;
    },

    _auraSync(rdt) {
        const ps = this._fxMgr();
        if (!ps) return;
        this._auraPickT -= rdt;
        if (this._auraPickT <= 0) { this._auraPickT = 0.5; this._pickAuraBots(); }
        for (const c of [...this._auras.keys()]) if (c.disposed || Game.chars.indexOf(c) < 0) this._auraDrop(c);
        const q = typeof GameFX !== 'undefined' ? GameFX.quality : 'high';
        for (const c of Game.chars) {
            const want = this._auraWant(c);
            let e = this._auras.get(c);
            if (e && (!want || e.id !== want.id || e.q !== q || (e.pending && this._texReady(want.aura.tex)))) { this._auraDrop(c); e = null; }
            if (!e && want) {
                const last = c.data.wrAuraFail || 0;
                if (Game.realTime - last > 2) e = this._auraMake(c, want, q);
            }
            if (e) this._auraTick(e, rdt);
        }
    },

    // Нужен ли эффект ауры персонажу сейчас: вещь каталога с aura, жив, виден, близко к камере.
    _auraWant(c) {
        const l = c.look;
        if (!l || !l.aura || !Character.isCosLook(l)) return null;
        if (c.disposed || c.hidden || c.state === 'dead' || c.h < -500 || !c.root || !c.root.isEnabled()) return null;
        if (!c.isPlayer && !this._auraBots.has(c)) return null;
        const it = Character.cosItem(l.aura);
        return it && it.aura ? it : null;
    },

    // Боты с эффектом — WR_AURA_BOTS ближайших к камере (не дальше WR_AURA_DIST).
    _pickAuraBots() {
        const cp = GameCamera.cam ? GameCamera.cam.position : null;
        /** @type {Array<{ c: Character, d: number }>} */
        const list = [];
        for (const c of Game.chars) {
            if (c.isPlayer || !c.look || !c.look.aura || c.state === 'dead' || c.hidden || c.disposed) continue;
            const d = cp ? Math.hypot(c.x - cp.x, c.y - cp.z, (c.h - cp.y) * 0.5) : 0;
            if (d < WR_AURA_DIST) list.push({ c, d });
        }
        list.sort((a, b) => a.d - b.d);
        this._auraBots = new Set(list.slice(0, WR_AURA_BOTS).map(x => x.c));
    },

    _auraDrop(c) {
        const e = this._auras.get(c);
        if (!e) return;
        this._auras.delete(c);
        if (e.h) e.h.dispose();
        if (e.anchor) e.anchor.dispose(false, false);
    },

    // Система частиц ауры: эмиттер — точка у ног персонажа (следует за ним, как эффекты GameFX),
    // позиции/направления — по стилю (смещения от эмиттера в осях карты).
    _auraMake(c, it, q) {
        const ps = this._fxMgr();
        const A = it.aura, scene = GameWorld.scene;
        if (!ps || !scene) return null;
        const S = WR_AURA_STYLE[A.style] || WR_AURA_STYLE.rise;
        const k = (c.isPlayer ? 1 : WR_AURA_BOT) * (q === 'low' ? WR_AURA_LOW : 1);
        const special = it.id === 'aura_rainbow' ? 'rainbow' : it.id === 'aura_glitch' ? 'glitch' : '';
        const tx = this._texFor(A);
        const tex = A.tex;
        const name = (s) => /** @type {RegExp} */ (s).test(tex);
        // Размер/скорость/жизнь — по стилю и текстуре.
        let size = S.size.slice(), life = S.life.slice(), speed = S.speed.slice(), rate = S.rate;
        if (A.style === 'rise') {
            if (name(/flame/)) { size = [34, 58]; life = [0.5, 0.85]; speed = [60, 120]; rate = 30; }
            else if (name(/smoke/)) { size = [50, 86]; life = [1, 1.6]; speed = [24, 50]; rate = 9; }
            else if (name(/glow_dot/)) { size = [8, 15]; rate = 22; }
        }
        if (A.style === 'orbit' && name(/ghost|butterfly/)) { size = [24, 34]; life = [1.1, 1.5]; speed = [30, 50]; rate = 7; }
        if (A.style === 'burst' && name(/confetti/)) { size = [14, 22]; life = [0.7, 1.1]; speed = [160, 300]; }
        if (A.style === 'burst' && name(/cube/)) { size = [10, 18]; life = [0.25, 0.42]; }
        if (A.style === 'swirl' && name(/crown/)) { size = [16, 24]; rate = 26; }
        const capacity = Math.ceil(Math.max(rate * 12, rate) * life[1] * 1.4 + 6);
        const col = '#' + Character.hex(tx.tint);
        const std = WR_AURA_STD.test(tex) && !special;
        const fade = A.style === 'pulse'
            ? [[0, col, 0.9], [0.6, col, 0.45], [1, col, 0]]
            : [[0, col, 0], [0.15, col, 0.95], [0.7, col, 0.8], [1, col, 0]];
        /** @type {any} */
        const opt = { name: 'aura', texture: undefined, rate: rate, capacity, life, size, speed: [1, 1], position: [c.x, c.h, c.y],
            blend: std ? 'standard' : 'add', color: col, follow: () => (c.disposed ? null : new BABYLON.Vector3(c.x, c.h, c.y)) };
        if (!special) opt.colorGradient = fade;
        if (A.style === 'pulse') opt.sizeGradient = [[0, 0.25], [1, 1.35]];
        else if (A.style === 'rise' && name(/flame/)) opt.sizeGradient = [[0, 0.5], [0.3, 1], [1, 0.2]];
        else if (name(/smoke/)) opt.sizeGradient = [[0, 0.5], [1, 1.4]];
        else opt.sizeGradient = [[0, 0.4], [0.2, 1], [1, 0.7]];
        if (name(/confetti_sheet/)) opt.sheet = { width: 64, height: 64, start: 0, end: 15, speed: 0, randomStart: true };
        if (A.style === 'fall' || name(/heart|music|leaf|petal|dollar|snowflake|butterfly|cube|ice_shard|star|sparkle|bolt|confetti/)) opt.spin = name(/heart|music|ghost|butterfly/) ? [-0.6, 0.6] : [-2.5, 2.5];
        opt.rate = rate * k;
        const h = ps.create(opt);
        if (!h) { c.data.wrAuraFail = Game.realTime; return null; }
        const sys = h.system;
        sys.particleTexture = tx.tex;
        sys.renderingGroupId = 1;
        if (opt.spin) { sys.minInitialRotation = 0; sys.maxInitialRotation = Math.PI * 2; }
        if (special) sys.colorDead = new BABYLON.Color4(0, 0, 0, 0);
        this._auraFns(sys, A.style, speed, special);
        const e = { id: it.id, h, anchor: null, q, pending: tx.pending, special, base: sys.emitRate, phase: Math.random() * 10, style: A.style };
        this._auras.set(c, e);
        return e;
    },

    // Позиции и направления частиц по стилю (смещения от точки у ног: y — вверх, тело ≈ 208 px).
    _auraFns(sys, style, speed, special) {
        const R = Math.random, TAU = Math.PI * 2;
        const sp = () => speed[0] + R() * (speed[1] - speed[0]);
        /** @type {{ x: number, y: number, z: number }} */
        const last = { x: 0, y: 0, z: 0 };
        let pos, dir;
        if (style === 'orbit') {
            pos = (wm, p) => {
                const arm = Math.floor(R() * 3), t = Game.time;
                const a = t * 2.4 + arm * TAU / 3 + (R() - 0.5) * 0.25, r = 64 + R() * 10;
                const y = 108 + Math.sin(t * 1.7 + arm * 2.1) * 58;
                p.set(Math.cos(a) * r, y, Math.sin(a) * r);
                last.x = -Math.sin(a); last.y = 0; last.z = Math.cos(a);
            };
            dir = (wm, d) => { const s = sp(); d.set(last.x * s, (R() - 0.5) * 6, last.z * s); };
        } else if (style === 'swirl') {
            pos = (wm, p) => {
                const arm = R() < 0.5 ? 0 : 1, t = Game.time;
                const y = (t * 95 + arm * 105 + R() * 12) % 215;
                const a = t * 3.1 + arm * Math.PI + y * 0.028, r = 50 + Math.sin(y * 0.03) * 8;
                p.set(Math.cos(a) * r, y, Math.sin(a) * r);
                last.x = -Math.sin(a); last.z = Math.cos(a);
            };
            dir = (wm, d) => { const s = sp(); d.set(last.x * s * 0.6, s * 0.5, last.z * s * 0.6); };
        } else if (style === 'fall') {
            pos = (wm, p) => { const a = R() * TAU, r = R() * 88; p.set(Math.cos(a) * r, 232 + R() * 40, Math.sin(a) * r); };
            dir = (wm, d) => { d.set((R() - 0.5) * 30, -sp(), (R() - 0.5) * 30); };
        } else if (style === 'burst') {
            pos = (wm, p) => {
                const a = R() * TAU, y = 40 + R() * 150, r = 26 + R() * 22;
                p.set(Math.cos(a) * r, y, Math.sin(a) * r);
                last.x = Math.cos(a); last.y = (y - 110) / 110; last.z = Math.sin(a);
                if (special === 'glitch') { p.x += (R() - 0.5) * 30; p.y += (R() - 0.5) * 20; }
            };
            dir = (wm, d) => { const s = sp(); d.set(last.x * s, last.y * s * 0.6 + (R() - 0.3) * 40, last.z * s); };
        } else if (style === 'pulse') {
            pos = (wm, p) => { p.set(0, 104, 0); };
            dir = (wm, d) => { d.set(0, 0, 0); };
        } else {
            pos = (wm, p) => { const a = R() * TAU, r = 28 + R() * 30; p.set(Math.cos(a) * r, 4 + R() * 150, Math.sin(a) * r); };
            dir = (wm, d) => { d.set((R() - 0.5) * 18, sp(), (R() - 0.5) * 18); };
        }
        // Смещение -> мир: матрица эмиттера-точки — перенос в его позицию.
        sys.startPositionFunction = (wm, p) => { pos(wm, p); BABYLON.Vector3.TransformCoordinatesFromFloatsToRef(p.x, p.y, p.z, wm, p); };
        sys.startDirectionFunction = (wm, d) => dir(wm, d);
        if (style === 'rise') sys.gravity = new BABYLON.Vector3(0, 30, 0);
        else if (style === 'fall') sys.gravity = new BABYLON.Vector3(0, -12, 0);
        else if (style === 'burst' && !special) sys.gravity = new BABYLON.Vector3(0, -120, 0);
        else sys.gravity = new BABYLON.Vector3(0, 0, 0);
        sys.minEmitPower = sys.maxEmitPower = 1;
    },

    // Каждый кадр: вспышки burst, радуга (смена цвета), глитч (RGB).
    _auraTick(e, rdt) {
        const sys = e.h.system;
        e.phase += rdt;
        if (e.style === 'burst') {
            const ph = e.phase % 0.75;
            sys.emitRate = ph < 0.12 ? e.base * 16 : e.base * 0.4;
        }
        if (e.special === 'rainbow') {
            const c = BABYLON.Color3.FromHSV((Game.time * 140) % 360, 0.75, 1);
            sys.color1.set(c.r, c.g, c.b, 1);
            sys.color2.set(c.r, c.g, c.b, 1);
        } else if (e.special === 'glitch') {
            const P = [[1, 0.16, 0.43], [0, 0.9, 1], [0.25, 1, 0.42]][Math.floor(Math.random() * 3)];
            sys.color1.set(P[0], P[1], P[2], 1);
            sys.color2.set(P[0], P[1], P[2], 1);
        }
    },

    // --- Текстуры эффектов: тонировать свою или серую копию ------------------------------------

    _texLoad(url) {
        if (!url || this._texInfo.has(url) || typeof Image === 'undefined') return;
        const info = { state: 'loading', colored: false, hue: 0, gray: null };
        this._texInfo.set(url, info);
        const img = new Image();
        img.onload = () => {
            try {
                const w = img.naturalWidth, h = img.naturalHeight;
                const cv = document.createElement('canvas');
                cv.width = w; cv.height = h;
                const ctx = cv.getContext('2d');
                ctx.drawImage(img, 0, 0);
                const data = ctx.getImageData(0, 0, w, h);
                const px = data.data;
                let n = 0, sat = 0, sx = 0, sy = 0, vmax = 1;
                for (let i = 0; i < px.length; i += 4) {
                    if (px[i + 3] < 100) continue;
                    const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
                    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
                    const s = mx > 0 ? (mx - mn) / mx : 0;
                    const c3 = new BABYLON.Color3(r, g, b).toHSV();
                    sat += s; n++;
                    sx += Math.cos(c3.r * Math.PI / 180) * s; sy += Math.sin(c3.r * Math.PI / 180) * s;
                }
                info.colored = n > 0 && sat / n > 0.22;
                info.hue = (Math.atan2(sy, sx) * 180 / Math.PI + 360) % 360;
                if (info.colored && GameWorld.scene) {
                    for (let i = 0; i < px.length; i += 4) vmax = Math.max(vmax, px[i], px[i + 1], px[i + 2]);
                    for (let i = 0; i < px.length; i += 4) {
                        const v = Math.min(255, Math.round(Math.max(px[i], px[i + 1], px[i + 2]) * 255 / vmax));
                        px[i] = px[i + 1] = px[i + 2] = v;
                    }
                    const dt = new BABYLON.DynamicTexture('wrGray|' + url, { width: w, height: h }, GameWorld.scene, true);
                    const dctx = /** @type {CanvasRenderingContext2D} */ (/** @type {any} */ (dt.getContext()));
                    dctx.putImageData(data, 0, 0);
                    dt.hasAlpha = true;
                    dt.update(false);
                    info.gray = dt;
                }
                info.state = 'ok';
            } catch (err) { info.state = 'ok'; info.colored = false; }
        };
        img.onerror = () => { info.state = 'fail'; };
        img.src = url;
    },

    _texReady(url) { const i = this._texInfo.get(url); return !!i && i.state !== 'loading'; },

    // Текстура и тон: белый тон — своя; цветная текстура под чужой оттенок — серая копия под тон.
    _texFor(A) {
        const ps = this._fxMgr();
        this._texLoad(A.tex);
        const info = this._texInfo.get(A.tex);
        const white = (A.color & 0xffffff) === 0xffffff;
        if (!info || info.state === 'loading') return { tex: ps.texture(A.tex), tint: A.color, pending: true };
        if (info.state === 'fail') return { tex: ps.texture(), tint: A.color, pending: false };
        if (!info.colored || white) return { tex: ps.texture(A.tex), tint: A.color, pending: false };
        const hsv = World3D.hexColor3(A.color).toHSV();
        let dh = Math.abs(hsv.r - info.hue) % 360;
        if (dh > 180) dh = 360 - dh;
        if (dh < 32 || !info.gray) return { tex: ps.texture(A.tex), tint: 0xffffff, pending: false };
        return { tex: info.gray, tint: A.color, pending: false };
    },
};

// Случайный элемент списка (свой — модуль ботов может быть не загружен).
function botsPickWR(list) { return list[Math.floor(Math.random() * list.length)]; }
