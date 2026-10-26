import logoUrl from '../assets/logo.png';

export function Logo({ className = '' }: { className?: string }) {
  return <img src={logoUrl} alt="" draggable={false} className={`select-none ${className}`} />;
}
