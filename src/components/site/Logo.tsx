import { Link } from "@tanstack/react-router";
import logoAsset from "@/assets/ace-logo.jpg";

export function Logo({ size = 36, withWordmark = true, className = "" }: { size?: number; withWordmark?: boolean; className?: string }) {
  return (
    <Link to="/" className={`flex items-center gap-2 ${className}`}>
      <img src={logoAsset} alt="AceTutor logo" width={size} height={size} className="object-contain" />
      {withWordmark && <span className="text-base font-bold tracking-tight">AceTutor</span>}
    </Link>
  );
}
