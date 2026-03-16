/// SM-2 Spaced Repetition Engine
/// Ported from Services/SpacedRepetitionEngine.swift
///
/// SM-2 algorithm: https://www.supermemo.com/en/archives1990-2015/english/ol/sm2

use crate::models::learning_card::LearningCard;

/// Review a card with quality 0–5 and update SM-2 fields.
/// Returns the updated card fields (ease_factor, interval, repetitions, next_review_date).
pub struct Sm2Result {
    pub ease_factor: f64,
    pub interval: i64,
    pub repetitions: i64,
    pub next_review_date: String,
}

/// Core SM-2 implementation.
/// quality: 0 = complete blackout, 5 = perfect recall
pub fn review_card(card: &LearningCard, quality: u8) -> Sm2Result {
    let q = quality.min(5) as f64;

    let (new_ef, new_reps, new_interval) = if q < 3.0 {
        // Failed: reset repetitions, keep interval at 1
        let ef = (card.ease_factor - 0.8 + 0.28 * q - 0.02 * q * q).max(1.3);
        (ef, 0i64, 1i64)
    } else {
        // Passed
        let ef = (card.ease_factor + 0.1 - (5.0 - q) * (0.08 + (5.0 - q) * 0.02)).max(1.3);
        let new_reps = card.repetitions + 1;
        let interval = match new_reps {
            1 => 1,
            2 => 6,
            _ => (card.interval as f64 * card.ease_factor).round() as i64,
        };
        (ef, new_reps, interval)
    };

    let today = chrono::Utc::now();
    let next_date = today + chrono::Duration::days(new_interval);
    let next_review_date = next_date.format("%Y-%m-%d").to_string();

    Sm2Result {
        ease_factor: new_ef,
        interval: new_interval,
        repetitions: new_reps,
        next_review_date,
    }
}

/// Leitner box system (5 boxes): alternative to SM-2
/// Box 1 = daily review, Box 5 = monthly review.
pub fn leitner_interval(box_number: u8) -> i64 {
    match box_number {
        1 => 1,
        2 => 3,
        3 => 7,
        4 => 14,
        5 => 30,
        _ => 1,
    }
}

pub fn leitner_advance(box_number: u8, recalled: bool) -> u8 {
    if recalled {
        (box_number + 1).min(5)
    } else {
        1
    }
}

/// Calculate retention score (0–1) based on time since last review and interval.
/// Uses the forgetting curve: R = e^(-t/S) where S is stability (interval).
pub fn retention_score(card: &LearningCard) -> f64 {
    if card.last_reviewed_at.is_none() {
        return 0.0;
    }
    let days_since = days_until_review(card).max(0) as f64;
    let s = card.interval as f64;
    (-days_since / s).exp()
}

/// Days until next review (negative = overdue)
pub fn days_until_review(card: &LearningCard) -> i64 {
    let today = chrono::Utc::now().date_naive();
    let review = chrono::NaiveDate::parse_from_str(&card.next_review_date, "%Y-%m-%d")
        .unwrap_or(today);
    (review - today).num_days()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::learning_card::LearningCard;

    fn make_card() -> LearningCard {
        LearningCard {
            id: "test".to_string(),
            project_id: "proj".to_string(),
            front: "Q".to_string(),
            back: "A".to_string(),
            source_type: "manual".to_string(),
            source_id: None,
            ease_factor: 2.5,
            interval: 1,
            repetitions: 0,
            next_review_date: "2026-03-16".to_string(),
            last_reviewed_at: None,
            created_at: "2026-03-16T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn test_perfect_recall_first_review() {
        let card = make_card();
        let result = review_card(&card, 5);
        assert_eq!(result.repetitions, 1);
        assert_eq!(result.interval, 1);
        assert!(result.ease_factor >= 2.5);
    }

    #[test]
    fn test_second_review() {
        let mut card = make_card();
        let r1 = review_card(&card, 5);
        card.repetitions = r1.repetitions;
        card.interval = r1.interval;
        card.ease_factor = r1.ease_factor;
        let result = review_card(&card, 5);
        assert_eq!(result.repetitions, 2);
        assert_eq!(result.interval, 6);
    }

    #[test]
    fn test_failed_recall_resets() {
        let mut card = make_card();
        card.repetitions = 5;
        card.interval = 14;
        let result = review_card(&card, 1);
        assert_eq!(result.repetitions, 0);
        assert_eq!(result.interval, 1);
        assert!(result.ease_factor <= 2.5);
    }

    #[test]
    fn test_minimum_ease_factor() {
        let card = make_card();
        let result = review_card(&card, 0);
        assert!(result.ease_factor >= 1.3);
    }
}
