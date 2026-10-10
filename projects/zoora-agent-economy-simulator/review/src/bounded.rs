use serde::{
    de::{self, SeqAccess, Visitor},
    Deserialize,
};
use std::{fmt, marker::PhantomData};
pub fn vec<'de, D, T, const N: usize>(d: D) -> Result<Vec<T>, D::Error>
where
    D: de::Deserializer<'de>,
    T: Deserialize<'de>,
{
    struct Bounded<T, const N: usize>(PhantomData<T>);
    impl<'de, T: Deserialize<'de>, const N: usize> Visitor<'de> for Bounded<T, N> {
        type Value = Vec<T>;
        fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
            write!(f, "an array with at most {N} entries")
        }
        fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Vec<T>, A::Error> {
            let mut result = Vec::new();
            while let Some(value) = seq.next_element()? {
                if result.len() == N {
                    return Err(de::Error::custom("array capacity exceeded"));
                }
                result.push(value);
            }
            Ok(result)
        }
    }
    d.deserialize_seq(Bounded::<T, N>(PhantomData))
}
