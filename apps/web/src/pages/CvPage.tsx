import { Link, useParams } from 'react-router';
import { useCv } from '../api/cvs';
import { errorMessage } from '../api/errors';
import { AppHeader } from '../components/AppHeader';
import { CrashBoundary } from '../components/CrashBoundary';
import { Spinner } from '../components/Icon';
import { CvEditor } from '../editor/CvEditor';
import { GenerationView } from './GenerationView';

/** One CV: its generation while there is no document, then the editor. */
export function CvPage() {
  const { id = '' } = useParams();
  const cv = useCv(id);

  if (cv.data === undefined && !cv.isError) {
    return (
      <>
        <AppHeader />
        <p className="save-status" role="status">
          <Spinner />
          Loading…
        </p>
      </>
    );
  }
  if (cv.data === undefined) {
    return (
      <>
        <AppHeader />
        <main className="page">
          <p role="alert">{errorMessage(cv.error)}</p>
          <Link to="/">Back to your CVs</Link>
        </main>
      </>
    );
  }
  const detail = cv.data;
  if (detail.document === null) return <GenerationView cv={detail} />;
  return (
    <CrashBoundary key={detail.id}>
      <CvEditor cv={detail} document={detail.document} />
    </CrashBoundary>
  );
}
