from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR.parent / "data" / "ml"
MODEL_DIR = BASE_DIR / "ml_models"


@dataclass
class MLConfig:
    """
    Central configuration for traffic forecasting / severity prediction model.
    Adjust these values based on your dataset and feature scope.
    """


    project_name: str = "traffic_forecasting_ml"
    dataset_path: str = str(DATA_DIR / "traffic_data.csv")
    model_output_path: str = str(MODEL_DIR / "traffic_model.pkl")
    scaler_output_path: str = str(MODEL_DIR / "scaler.pkl")
    label_encoder_output_path: str = str(MODEL_DIR / "label_encoder.pkl")


    target_column: str = "future_speedband"


    feature_columns: List[str] = field(default_factory=lambda: [
        "road_segment",
        "day_of_week",
        "hour_of_day",
        "current_speed",
        "avg_speed_last_15min",
        "avg_speed_last_30min",
        "weather_condition",
        "is_peak_hour"
    ])


    categorical_columns: List[str] = field(default_factory=lambda: [
        "road_segment",
        "weather_condition"
    ])

    numerical_columns: List[str] = field(default_factory=lambda: [
        "day_of_week",
        "hour_of_day",
        "current_speed",
        "avg_speed_last_15min",
        "avg_speed_last_30min",
        "is_peak_hour"
    ])


    test_size: float = 0.2
    random_state: int = 42


    model_type: str = "random_forest_classifier"

    n_estimators: int = 200
    max_depth: Optional[int] = 10
    min_samples_split: int = 2
    min_samples_leaf: int = 1

    max_iter: int = 1000


    forecast_horizon_minutes: int = 5


    severity_mapping: dict = field(default_factory=lambda: {
        "Green": "Low",
        "Amber": "Medium",
        "Red": "High"
    })


    def validate(self) -> None:
        if not self.feature_columns:
            raise ValueError("feature_columns cannot be empty.")

        if self.target_column in self.feature_columns:
            raise ValueError("target_column must not be inside feature_columns.")

        if self.model_type not in {
            "random_forest_classifier",
            "random_forest_regressor",
            "logistic_regression"
        }:
            raise ValueError(f"Unsupported model_type: {self.model_type}")

        if not (0 < self.test_size < 1):
            raise ValueError("test_size must be between 0 and 1.")

        if self.forecast_horizon_minutes <= 0:
            raise ValueError("forecast_horizon_minutes must be greater than 0.")


if __name__ == "__main__":
    config = MLConfig()
    config.validate()
    print("ML configuration loaded successfully.")
    print(config)
