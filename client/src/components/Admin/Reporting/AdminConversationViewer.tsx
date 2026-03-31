import { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { buildTree } from 'librechat-data-provider';
import { Spinner } from '@librechat/client';
import { ShareMessagesProvider } from '~/components/Share/ShareMessagesProvider';
import MessagesView from '~/components/Share/MessagesView';
import { useGetAdminConversation } from '~/data-provider';
import { ShareContext } from '~/Providers';

function AdminHeader({
  title,
  owner,
  endpoint,
  model,
  createdAt,
  onBack,
}: {
  title: string;
  owner: { name: string; email: string; username: string } | null;
  endpoint?: string;
  model?: string;
  createdAt?: string;
  onBack: () => void;
}) {
  const formattedDate = createdAt
    ? new Date(createdAt).toLocaleDateString(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    : null;

  return (
    <section className="mx-auto w-full px-2 pb-3 pt-4 md:px-5 md:pb-4 md:pt-6">
      <div className="bg-surface-primary/80 relative mx-auto flex w-full max-w-[60rem] flex-col gap-3 rounded-2xl border border-border-light px-4 py-4 shadow-xl backdrop-blur md:gap-4 md:rounded-3xl md:px-6 md:py-5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20"
          >
            &larr; Back to Dashboard
          </button>
          <span className="text-xs text-text-tertiary">Admin Conversation Viewer</span>
        </div>
        <div className="min-w-0 space-y-1.5 md:space-y-2">
          <h1 className="line-clamp-2 break-words text-2xl font-semibold text-text-primary md:text-3xl">
            {title}
          </h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-secondary">
            {owner && (
              <span>
                <span className="font-medium">{owner.name || owner.username}</span>
                {owner.email && (
                  <span className="ml-1 text-text-tertiary">({owner.email})</span>
                )}
              </span>
            )}
            {endpoint && (
              <span>
                Endpoint: <span className="font-medium">{endpoint}</span>
              </span>
            )}
            {model && (
              <span>
                Model: <span className="font-medium">{model}</span>
              </span>
            )}
            {formattedDate && <span>{formattedDate}</span>}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function AdminConversationViewer() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const { data, isLoading, isError } = useGetAdminConversation(conversationId ?? '');

  const messagesTree = useMemo(() => {
    if (!data?.messages) {
      return null;
    }
    const tree = buildTree({ messages: data.messages });
    return tree && tree.length > 0 ? tree : null;
  }, [data?.messages]);

  const handleBack = () => {
    navigate('/d/reporting');
  };

  let content: JSX.Element;

  if (isLoading) {
    content = (
      <div className="flex h-screen items-center justify-center">
        <Spinner className="" />
      </div>
    );
  } else if (isError) {
    content = (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <p className="text-text-secondary">Failed to load conversation.</p>
        <button
          type="button"
          onClick={handleBack}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Back to Dashboard
        </button>
      </div>
    );
  } else if (data && messagesTree) {
    content = (
      <>
        <AdminHeader
          title={data.title}
          owner={data.owner}
          endpoint={data.endpoint}
          model={data.model}
          createdAt={data.createdAt}
          onBack={handleBack}
        />
        <ShareMessagesProvider messages={data.messages}>
          <MessagesView messagesTree={messagesTree} conversationId={conversationId ?? 'admin-view'} />
        </ShareMessagesProvider>
      </>
    );
  } else {
    content = (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <p className="text-text-secondary">Conversation not found.</p>
        <button
          type="button"
          onClick={handleBack}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <ShareContext.Provider value={{ isSharedConvo: true }}>
      <div className="relative flex h-screen w-full overflow-hidden dark:bg-surface-secondary">
        <main className="relative flex w-full grow overflow-hidden dark:bg-surface-secondary">
          <div className="transition-width relative flex h-full w-full flex-1 flex-col items-stretch overflow-hidden pt-0 dark:bg-surface-secondary">
            <div className="relative flex h-full min-h-0 flex-col text-text-primary" role="presentation">
              {content}
            </div>
          </div>
        </main>
      </div>
    </ShareContext.Provider>
  );
}
