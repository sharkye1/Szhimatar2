# Структура проекта Szhimatar

```
Szhimatar2/
│
├── 📁 src/                                # Frontend (React + TypeScript)
│   ├── 📁 components/                     # React компоненты
│   │   ├── AppVersion.tsx                 # Компонент отображения версии
│   │   └── MotionScreen.tsx               # Wrapper для анимации экранов
│   │
│   ├── 📁 contexts/                       # React Contexts (глобальное состояние)
│   │   ├── ThemeContext.tsx               # Управление темами (светлая/тёмно-красная)
│   │   └── LanguageContext.tsx            # Управление локализацией (RU/EN)
│   │
│   ├── 📁 pages/                          # Страницы приложения (экраны навигации)
│   │   ├── MainWindow.tsx                 # Главное окно (очередь файлов, управление)
│   │   ├── VideoSettings.tsx              # Настройки видео (кодек, качество)
│   │   ├── AudioSettings.tsx              # Настройки аудио (битрейт, канал)
│   │   ├── GeneralSettings.tsx            # Общие настройки (тема, язык)
│   │   └── WatermarkSettings.tsx          # Настройки водяного знака
│   │
│   ├── 📁 styles/                         # CSS стили
│   │   ├── global.css                     # Глобальные стили, CSS переменные, анимации
│   │   ├── MainWindow.css                 # Стили главного окна
│   │   └── SettingsWindow.css             # Стили экранов настроек
│   │
│   ├── 📁 utils/                          # Утилиты и вспомогательные функции
│   │   ├── logger.ts                      # Система логирования (write_log в Rust)
│   │   ├── statistics.ts                  # Управление статистикой сжатий
│   │   └── ffmpeg.ts                      # FFmpeg интеграция (заглушка для будущего)
│   │
│   ├── 📁 types/                          # TypeScript интерфейсы
│   │   └── index.ts                       # Общие типы приложения
│   │
│   ├── 📁 themes/                         # JSON темы оформления
│   │   ├── light.json                     # Светлая тема (синяя)
│   │   └── dark-red.json                  # Тёмно-красная тема
│   │
│   ├── 📁 lang/                           # Языковые файлы (локализация)
│   │   ├── ru.json                        # Русский язык
│   │   └── en.json                        # Английский язык
│   │
│   ├── App.tsx                            # Главный компонент (навигация, screen state)
│   ├── main.tsx                           # Точка входа React (ReactDOM.render)
│   └── version.ts                         # Версия приложения (автоматически из package.json)
│
├── 📁 src-tauri/                          # Backend (Rust + Tauri)
│   ├── 📁 src/
│   │   └── main.rs                        # Основной файл (3 команды: load_settings, save_settings, write_log)
│   │
│   ├── 📁 icons/                          # Иконки приложения (автогенерируется)
│   │
│   ├── Cargo.toml                         # Rust зависимости (версия синхронизируется)
│   ├── tauri.conf.json                    # Конфигурация Tauri (версия синхронизируется)
│   └── build.rs                           # Build script
│
├── 📁 .git/                               # Git репозиторий
│
├── 📄 package.json                        # npm зависимости (React, Vite, Tauri)
├── 📄 package-lock.json                   # Зафиксированные версии npm пакетов
├── 📄 tsconfig.json                       # TypeScript конфигурация
├── 📄 tsconfig.node.json                  # TypeScript для Vite/build
├── 📄 vite.config.ts                      # Vite конфигурация
├── 📄 .eslintrc.cjs                       # ESLint правила
├── 📄 .gitignore                          # Git ignore 
├── 📄 index.html                          # HTML точка входа (единственная)
│
├── 📄 sync-version.js                     # Скрипт синхронизации версии (npm run sync-version)
│
├── 📚 ДОКУМЕНТАЦИЯ:
│   ├── README.md                          # Ну тут и так понятно
│   ├── PROJECT_STRUCTURE.md               # А тут темболее 

```

## 📂 Папки, создаваемые во время работы

```
~/.szhimatar/                        # Папка данных приложения
├── 📁 logs/
│   └── app.log                      # Лог файл действий
├── 📁 stats/
│   └── stat.json                    # Статистика сжатий (будущее)
└── settings.json                    # Настройки пользователя
```

## 🗂️ Ключевые компоненты

### Frontend (React + TypeScript 5.3)

| Компонент | Назначение |
|-----------|-----------|
| **Contexts** | Глобальное состояние через React Context API (темы, язык) |
| **Pages** | Отдельные экраны (MainWindow, 4 Settings экрана) |
| **Components** | Переиспользуемые компоненты (MotionScreen для анимации, AppVersion) |
| **Utils** | Вспомогательные функции (логирование, статистика, FFmpeg заглушка) |
| **Styles** | CSS с CSS Variables для поддержки динамических тем |

### Backend (Rust + Tauri 1.5)

| Команда | Назначение |
|---------|-----------|
| `load_settings()` | Загрузка настроек из `~/.szhimatar/settings.json` |
| `save_settings()` | Сохранение настроек |
| `write_log()` | Запись в лог файл `~/.szhimatar/logs/app.log` |

### Система навигации

- **Architecture**: Single-window SPA с React state management (не React Router)
- **Navigation Type**: `Screen = 'main' \| 'video' \| 'audio' \| 'general' \| 'watermark'`
- **Animation**: Framer-motion (AnimatePresence + MotionScreen) для плавных переходов между экранами
- **Back Button**: ESC возвращает на главный экран

### Система тем

Темы загружаются из JSON и применяются через CSS Variables:
```css
--color-background    /* Цвет фона */
--color-surface       /* Цвет поверхностей */
--color-primary       /* Основной цвет */
--color-text          /* Цвет текста */
--color-accent        /* Акцентный цвет */
/* и др. */
```

Темы подгружаются в `ThemeContext.tsx` и применяются к `MotionScreen` элементам для предотвращения белых вспышек при анимации.

### Система локализации

Переводы хранятся в `src/lang/*.json` и доступны через функцию `t()`:
```typescript
import { useLanguage } from '../contexts/LanguageContext';

const { t } = useLanguage();
const text = t('main.selectFiles');  // → "Выбрать файлы" (ru) или "Select Files" (en)
```

### Система версионирования

Версия определяется **в одном месте** — `package.json`:
```json
{
  "version": "0.2.1"
}
```

Синхронизация на другие файлы:
```bash
npm run sync-version
```

Обновляет:
- ✅ `src-tauri/tauri.conf.json`
- ✅ `src-tauri/Cargo.toml`

Использование в коде:
```typescript
import { APP_VERSION } from './version';

<AppVersion />  
```

## 🔌 Точки расширения

1. **Добавление новой темы**:
   - Создать `src/themes/new-theme.json`
   - Добавить в `ThemeContext.tsx` (в список themes)

2. **Добавление языка**:
   - Создать `src/lang/xx.json`
   - Добавить в `LanguageContext.tsx` (в список languages и defaultLanguage)

3. **Добавление нового экрана**:
   - Создать `src/pages/NewScreen.tsx` (с props: `onNavigate`, `onBack`)
   - Добавить тип в `App.tsx` (Screen union)
   - Добавить case в switch в `App.tsx`

4. **Добавление Rust команды**:
   - Добавить `#[tauri::command]` функцию в `src-tauri/src/main.rs`
   - Импортировать и вызвать через `invoke()` в React

## 📊 Потоки данных

```
┌─────────────────────────────────────────────────────────────┐
│  React Component → User Action                              │
│  (click button) ↓                                           │
│  navigateTo('video') → setCurrentScreen('video')            │
│  → MotionScreen анимирует выход старого экрана              │
│  → MotionScreen анимирует вход нового экрана                │
│  → Новая страница (VideoSettings.tsx) отображается          │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  React → Tauri Backend                                      │
│  invoke('load_settings') ↓                                  │
│  → Rust функция load_settings()                             │
│  → Читает ~/.szhimatar/settings.json                        │
│  → Возвращает JSON обратно в React                          │
│  → ThemeContext/LanguageContext обновляют состояние         │
└─────────────────────────────────────────────────────────────┘
```

## 📦 Основные зависимости

| Пакет | Версия | Назначение |
|-------|--------|-----------|
| React | 18.2.0 | UI фреймворк |
| TypeScript | 5.3+ | Типизация |
| Vite | 5+ | Build tool |
| Tauri | 1.5 | Desktop framework |
| Framer-motion | 12.27.0 | Анимации переходов |

---

## 📋 Важные файлы

- 📄 **package.json** - главный источник версии приложения
- 🏗️ **src/App.tsx** - хаб навигации (управление currentScreen состоянием)
- 🎨 **src/components/MotionScreen.tsx** - wrapper для анимированных экранов
- ⚙️ **src-tauri/main.rs** - 3 простые Rust команды
- 📚 **ARCHITECTURE.md** - подробная архитектура приложения
- 📚 **VERSION_MANAGEMENT.md** - управление версией

---

**Текущая версия**: 0.2.1
**Дата обновления**: Январь 20, 2026  
**Статус**: В активной разработке ✅  
**Архитектура**: Single-window SPA с React state-based навигацией  
**Платформа**: Tauri 1.5 (Windows/Linux/macOS compatible)
