export const metadata = { title: '離線' };

export default function OfflinePage() {
  return (
    <main className="pad-top pad-bottom flex min-h-dvh flex-col items-center justify-center gap-3 px-8 text-center">
      <p className="text-sm">現在連不上網路</p>
      <p className="text-xs text-text-faint">
        這一版還不能離線記帳，等收訊回來再記一次。
        <br />
        先在手機備忘錄寫下來，回頭補進去也可以。
      </p>
    </main>
  );
}
