import RiskForm from "./RiskForm";
import styles from "./RiskForm.module.css";

export default function Home() {
  return (
    <main className={styles.main}>
      <h1 className={styles.title}>전세레이더</h1>
      <p className={styles.lead}>
        등기부등본과 계약서의 값을 입력하면, 전세 사기·깡통전세 위험을 이유와 함께 알려드려요.
      </p>
      <RiskForm />
    </main>
  );
}
