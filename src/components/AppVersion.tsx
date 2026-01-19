import { APP_VERSION } from '../version';

export function AppVersion() {
  return (
    <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
      <span>v{APP_VERSION}</span>
    </div>
  );
}
