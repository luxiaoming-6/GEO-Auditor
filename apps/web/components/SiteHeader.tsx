import Link from "next/link";

// Top navigation shared by every page (server component — plain links only).
export default function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link className="brand" href="/">
          BotGaze
        </Link>
        <nav>
          <Link href="/">首页</Link>
          <Link href="/reports">检测报告</Link>
        </nav>
      </div>
    </header>
  );
}
