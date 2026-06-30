import './ManaLogo.css';

type Props = {
  variant?: 'full' | 'compact';
};

export default function ManaLogo({ variant = 'full' }: Props) {
  if (variant === 'compact') {
    return (
      <div className="manaLogo manaLogoCompact" aria-label="MANA">
        <span>MANA</span>
      </div>
    );
  }

  return (
    <div className="manaLogo manaLogoFull" aria-label="MANA центр киберспорта">
      <img src="/assets/mana-logo.png" alt="MANA центр киберспорта" />
    </div>
  );
}
