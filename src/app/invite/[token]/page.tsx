import { Cpu, CheckCircle2, XCircle } from "lucide-react";
import Link from "next/link";
import { acceptInvite } from "@/lib/org/inviteService";

interface Props {
  params: Promise<{ token: string }>;
}

export default async function AcceptInvitePage({ params }: Props) {
  const { token } = await params;
  const invite = acceptInvite(token);

  return (
    <div className="min-h-screen bg-[#080a0d] flex items-center justify-center p-6">
      <div className="w-full max-w-sm text-center space-y-6">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
            <Cpu className="w-5 h-5 text-indigo-400" />
          </div>
          <span className="text-lg font-semibold text-[#e2e5ed]">Sentinel OS</span>
        </div>

        {invite ? (
          <div className="bg-[#0f1117] border border-[#1e2130] rounded-2xl p-6 space-y-4">
            <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-[#e2e5ed]">Invite accepted</h1>
              <p className="text-sm text-[#7a8099] mt-1">
                Welcome to Sentinel OS. Your account is being set up.
              </p>
            </div>
            <div className="bg-[#0c0e12] rounded-xl p-3 text-left space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-[#5a5f6e]">Email</span>
                <span className="text-[#c8cdd8]">{invite.email}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-[#5a5f6e]">Role</span>
                <span className="text-[#c8cdd8] capitalize">{invite.roleId}</span>
              </div>
              {invite.title && (
                <div className="flex justify-between text-xs">
                  <span className="text-[#5a5f6e]">Title</span>
                  <span className="text-[#c8cdd8]">{invite.title}</span>
                </div>
              )}
            </div>
            <Link
              href="/auth/signin"
              className="block w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-sm text-white font-medium text-center transition-colors"
            >
              Sign in to Sentinel OS
            </Link>
          </div>
        ) : (
          <div className="bg-[#0f1117] border border-[#1e2130] rounded-2xl p-6 space-y-4">
            <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto">
              <XCircle className="w-6 h-6 text-red-400" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-[#e2e5ed]">Invite not found</h1>
              <p className="text-sm text-[#7a8099] mt-1">
                This invite link is invalid, expired, or has already been used.
              </p>
            </div>
            <Link
              href="/"
              className="block w-full py-2.5 rounded-xl border border-[#1e2130] text-sm text-[#7a8099] hover:text-[#e2e5ed] text-center transition-colors"
            >
              Go to Sentinel OS
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
