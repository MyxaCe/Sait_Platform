export type EnrollmentGate = 'ok' | 'enroll' | 'unavailable';

export async function enrollmentGate(
  operatorId: string,
  isEnrolled: (operatorId: string) => Promise<boolean>,
): Promise<EnrollmentGate> {
  try {
    return (await isEnrolled(operatorId)) === true ? 'ok' : 'enroll';
  } catch (err) {
    console.error('[admin] проверка 2FA оператора не выполнена:', (err as Error)?.message ?? err);
    return 'unavailable';
  }
}
