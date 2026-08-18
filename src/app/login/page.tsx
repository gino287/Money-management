import { LoginForm } from './LoginForm';

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const { next, e } = await searchParams;

  return (
    <main className="pad-top pad-bottom flex min-h-dvh flex-col items-center justify-center px-6">
      <div className="w-full max-w-xs">
        <div className="mb-10 text-center">
          <div className="mb-3 text-4xl">◈</div>
          <h1 className="text-lg font-medium tracking-wide">記帳</h1>
        </div>
        <LoginForm next={typeof next === 'string' ? next : '/'} error={e === '1'} />
      </div>
    </main>
  );
}
