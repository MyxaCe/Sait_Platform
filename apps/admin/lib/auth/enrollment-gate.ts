/**
 * Решение гейта защищённой зоны по второму фактору (ADM-13, Р-454 III-3).
 *
 * Fail-closed: если проверить, включена ли у оператора 2FA, НЕ удалось (база
 * не ответила), — внутрь не пускаем, но и не роняем страницу стектрейсом:
 * layout показывает «Сервис временно недоступен». Пропустить без проверки
 * нельзя ни при каком исходе, кроме явного `true`.
 */
export type EnrollmentGate = 'ok' | 'enroll' | 'unavailable';

export async function enrollmentGate(
  operatorId: string,
  isEnrolled: (operatorId: string) => Promise<boolean>,
): Promise<EnrollmentGate> {
  try {
    return (await isEnrolled(operatorId)) === true ? 'ok' : 'enroll';
  } catch (err) {
    // Причина — в лог сервера; оператору — спокойный отказ без деталей.
    console.error('[admin] проверка 2FA оператора не выполнена:', (err as Error)?.message ?? err);
    return 'unavailable';
  }
}
