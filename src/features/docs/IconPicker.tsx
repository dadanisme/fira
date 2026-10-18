import { useState, type ReactNode } from 'react';
import { Popover, type PopoverTriggerProps } from '../../components/Popover';
import { Button } from '../../components/Button';
import { cx } from '../../lib/cx';

const EMOJI = (
  '📄 📝 📌 📎 📚 📖 📓 📒 📋 🗂️ 🗒️ 📁 📊 📈 🧾 ✅ ☑️ 🔖 🏷️ 💡 🔥 ⭐ ✨ 🚀 🎯 🧠 🛠️ 🔧 ⚙️ 🧪 🐛 🔒 🔑 🌐 💻 🖥️ 📱 🗺️ 🧭 📅 ⏰ ⏳ 💬 📣 ❓ ❗ ⚠️ 🚧 ' +
  '🎨 🎬 🎵 📷 🏠 🏢 🌱 🌳 🌊 ☀️ 🌙 ⚡ 🍀 🍎 ☕ 🍕 🎉 🎁 🏆 💰 💳 🛒 📦 🚚 ✈️ 🧳 ❤️ 💙 💚 💛 💜 🖤 🤝 👋 👀 🙂 😎 🤖 👾 🦊 🐱 🐶 🦄'
).split(' ');

/** Simple emoji grid with "Remove". */
export function IconPicker({
  value,
  onChange,
  trigger,
}: {
  value?: string;
  onChange: (icon: string | null) => void;
  trigger: (props: PopoverTriggerProps) => ReactNode;
}) {
  const [custom, setCustom] = useState('');
  return (
    <Popover trigger={trigger} className="w-[300px] p-2">
      {({ close }) => (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-10 gap-0.5">
            {EMOJI.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => {
                  onChange(e);
                  close();
                }}
                className={cx('flex size-7 items-center justify-center rounded text-lg hover:bg-hover', e === value && 'bg-active')}
              >
                {e}
              </button>
            ))}
          </div>
          <form
            className="flex items-center gap-1.5"
            onSubmit={(ev) => {
              ev.preventDefault();
              const icon = [...new Intl.Segmenter().segment(custom.trim())][0]?.segment;
              if (icon) onChange(icon);
              close();
            }}
          >
            <input
              value={custom}
              onChange={(ev) => setCustom(ev.target.value)}
              placeholder="Any emoji…"
              className="h-7 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 text-[13px] outline-none focus:border-accent"
            />
            {value && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onChange(null);
                  close();
                }}
              >
                Remove
              </Button>
            )}
          </form>
        </div>
      )}
    </Popover>
  );
}
