import RiskForm from "./RiskForm";
import styles from "./RiskForm.module.css";

export default function Home() {
  return (
    <main className={styles.main}>
      <h1 className={styles.title}>전세레이더</h1>
      <p className={styles.lead}>
        등기부등본(과 계약서)을 올리면 등기부를 쉬운 말로 요약하고, 국토교통부 안내서 체크리스트에 따라 계약 전·계약할 때·계약 후에 확인할 17가지를 알려드려요.
      </p>
      <RiskForm />
    </main>
  );
}
